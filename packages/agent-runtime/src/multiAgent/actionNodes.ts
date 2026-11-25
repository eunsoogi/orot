import { executionLimit } from './executionLimits';
import { exceedsEvidenceCapacity } from './evidenceCapacity';
import { AuthorizationPaused, isAuthorizationPaused } from './journaledModelCall';
import { observeUntilAbort } from './modelCall';
import { referencesFromBatch, validateEvidenceBatch } from './evidence';
import { appendNativeToolResultMessage } from './nativeTools';
import { canonicalJson, utf8ByteLength } from './protocol';
import {
  canceled,
  completeState,
  operationKey,
  stop,
  emitToolEvent,
  finishToolEvent,
} from './runtimeContext';
import type { RuntimeContext } from './runtimeContext';
import type { WorkflowState } from './state';

/** A separate checkpointed action node keeps mutations out of read-only search.
 * Pending dispatch is never resumable; only the domain's committed receipt can
 * prove a result. No grant is serialized and cancellation is checked before dispatch.
 */
export function createActionNodes<TResult>(context: RuntimeContext<TResult>) {
  let terminalClaimed = false;
  return {
    prepareAction(state: WorkflowState) {
      const tool = context.options.actions?.find((item) => item.id === state.selectedToolId);
      if (context.signal.aborted) {
        canceled(context);
        return completeState();
      }
      if (
        !tool ||
        !context.researchInput ||
        state.toolCalls >= executionLimit(state.budget, 'maxToolCalls')
      ) {
        stop(context, 'The local action cannot be dispatched.', 'invalid_output');
        return completeState();
      }
      return {
        toolCalls: state.toolCalls + 1,
        pendingOperation: {
          kind: 'tool' as const,
          operationKey: operationKey('tool', state.toolCalls + 1),
        },
      };
    },
    async executeAction(state: WorkflowState) {
      const tool = context.options.actions?.find((item) => item.id === state.selectedToolId);
      const input = context.researchInput;
      if (!tool || !input || state.pendingOperation?.kind !== 'tool') {
        stop(context, 'The local action handoff is invalid.', 'invalid_output');
        return completeState();
      }
      const operationRunId = state.operationRunId;
      const operationKeyValue = state.pendingOperation.operationKey;
      const terminal = tool.completion === 'host_terminal';
      const confirmTerminal = context.options.confirmTerminalLocalAction;
      if (
        terminal &&
        (!confirmTerminal ||
          terminalClaimed ||
          state.committedAction ||
          operationRunId !== context.options.execution.operationRunId ||
          !Number.isSafeInteger(state.toolCalls) ||
          state.toolCalls < 1 ||
          operationKeyValue !== operationKey('tool', state.toolCalls))
      ) {
        stop(context, 'The terminal local action owner is invalid.', 'invalid_output');
        return completeState();
      }
      if (terminal) terminalClaimed = true;
      const approval =
        context.options.checkpointer && context.options.operationJournal?.loadPrepared
          ? context.pause?.approvalSignal(context.signal)
          : undefined;
      const approvalSignal = approval?.signal ?? context.signal;
      let pausedBeforeDispatch = false;
      const notify = (waiting: boolean) => {
        try {
          context.onApprovalWait?.(waiting);
        } catch {
          /* UI observers cannot grant access. */
        }
      };
      try {
        const terminalInput = terminal ? canonicalJson(input) : undefined;
        if (context.signal.aborted) {
          canceled(context);
          return completeState();
        }
        if (context.beforeTaskInputChange) await context.beforeTaskInputChange(context.signal);
        if (context.signal.aborted) {
          canceled(context);
          return completeState();
        }
        notify(Boolean(approval));
        const decision = await observeUntilAbort(
          tool.authorize(
            input,
            approvalSignal,
            terminal ? { operationRunId, operationKey: operationKeyValue } : undefined,
          ),
          approvalSignal,
        );
        if (approvalSignal.aborted && !context.signal.aborted && approval) {
          pausedBeforeDispatch = true;
          throw new AuthorizationPaused();
        }
        approval?.finishApproval();
        notify(false);
        if (context.signal.aborted) {
          canceled(context);
          return completeState();
        }
        if (decision.kind !== 'value' || !decision.value) {
          stop(context, 'The local action needs an explicit user decision.', 'consent_required');
          return completeState();
        }
        if (context.signal.aborted) {
          canceled(context);
          return completeState();
        }
        await context.options.beforeLocalAction?.(state, approvalSignal);
        if (context.signal.aborted || approvalSignal.aborted) {
          canceled(context);
          return completeState();
        }
        // Await the transaction even after cancellation; do not race an uncertain write
        // with another attempt. The domain also checks cancellation inside its transaction.
        context.activeToolEvent = {
          version: 1,
          operationRunId: state.operationRunId,
          callId: state.pendingOperation.operationKey,
          toolName: tool.id,
          order: state.toolCalls,
          status: 'started',
          inputSummary: { sourceKind: 'personal_record' },
          sources: [],
        };
        emitToolEvent(context, context.activeToolEvent);
        if (terminal && terminalInput !== canonicalJson(input)) {
          stop(context, 'The terminal local action input changed.', 'invalid_output');
          return completeState();
        }
        const batch = await tool.execute({
          input,
          operationRunId: state.operationRunId,
          operationKey: state.pendingOperation.operationKey,
          signal: approvalSignal,
        });
        if (terminal && confirmTerminal && terminalInput !== undefined) {
          if (context.signal.aborted || approvalSignal.aborted) {
            canceled(context);
            return completeState();
          }
          if (batch.items.length || batch.coverage.length || batch.conflicts.length) {
            stop(context, 'A terminal local action cannot export evidence.', 'invalid_output');
            return completeState();
          }
          const result = await confirmTerminal({
            operationRunId,
            operationKey: operationKeyValue,
            toolId: tool.id,
            toolVersion: tool.version,
            input: JSON.parse(terminalInput),
            signal: approvalSignal,
          });
          if (context.signal.aborted || approvalSignal.aborted) {
            canceled(context);
            return completeState();
          }
          if (!result) {
            stop(context, 'The terminal local action receipt is unavailable.', 'unavailable');
            return completeState();
          }
          finishToolEvent(context, 'completed', []);
          context.researchInput = undefined;
          context.pendingNativeToolCallId = undefined;
          context.outcome = { status: 'result', value: result.value, citations: [] };
          return { ...completeState(), committedAction: result.committed !== false };
        }
        // The transaction's successful result is truthful even if cancellation arrives afterward.
        finishToolEvent(context, 'completed', batch.items);
        if (context.signal.aborted) {
          canceled(context);
          return completeState();
        }
        if (
          batch.items.some((item) => item.sourceKind !== 'personal_record') ||
          validateEvidenceBatch(batch, context.options.execution.allowedScope, state.budget) ||
          utf8ByteLength(canonicalJson(batch)) > executionLimit(state.budget, 'maxPayloadBytes')
        ) {
          stop(context, 'The committed action result could not be validated.', 'invalid_output');
          return completeState();
        }
        const combined = {
          items: [...context.currentEvidence.items, ...batch.items],
          coverage: [...context.currentEvidence.coverage, ...batch.coverage],
          conflicts: [...context.currentEvidence.conflicts, ...batch.conflicts],
        };
        if (
          exceedsEvidenceCapacity(state.budget, combined.items.length) ||
          !(await context.options.revalidateEvidence(referencesFromBatch(combined), context.signal))
        ) {
          stop(context, 'The committed action evidence is unavailable.', 'stale_evidence');
          return completeState();
        }
        if (
          !appendNativeToolResultMessage(
            context.nativeToolMessages,
            context.pendingNativeToolCallId,
            { status: 'saved', evidenceIds: batch.items.map((item) => item.evidenceId) },
          )
        ) {
          stop(context, 'The committed action response cannot be linked.', 'invalid_output');
          return completeState();
        }
        context.currentEvidence = combined;
        context.researchInput = undefined;
        context.pendingNativeToolCallId = undefined;
        return {
          phase: 'revised_response' as const,
          committedAction: true,
          committedActionReceipts: [
            ...(state.committedActionReceipts ?? []),
            {
              version: 1 as const,
              operationRunId: state.operationRunId,
              operationKey: state.pendingOperation.operationKey,
              toolId: tool.id,
              toolVersion: tool.version,
              evidenceReferences: referencesFromBatch(batch),
            },
          ],
          evidenceReferences: referencesFromBatch(combined),
          pendingOperation: undefined,
        };
      } catch (error) {
        if (pausedBeforeDispatch && isAuthorizationPaused(error)) throw error;
        stop(context, 'The action outcome is unknown; do not repeat it.', 'unavailable');
        return completeState();
      } finally {
        notify(false);
        approval?.dispose();
      }
    },
  };
}
