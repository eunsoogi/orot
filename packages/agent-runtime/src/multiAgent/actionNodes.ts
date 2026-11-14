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
  return {
    prepareAction(state: WorkflowState) {
      const tool = context.options.actions?.find((item) => item.id === state.selectedToolId);
      if (context.signal.aborted) {
        canceled(context);
        return completeState();
      }
      if (!tool || !context.researchInput || state.toolCalls >= state.budget.maxToolCalls) {
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
      try {
        if (context.signal.aborted) {
          canceled(context);
          return completeState();
        }
        if (context.beforeTaskInputChange) await context.beforeTaskInputChange(context.signal);
        if (context.signal.aborted) {
          canceled(context);
          return completeState();
        }
        if (!(await tool.authorize(input, context.signal))) {
          stop(context, 'The local action needs an explicit user decision.', 'consent_required');
          return completeState();
        }
        if (context.signal.aborted) {
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
        const batch = await tool.execute({
          input,
          operationRunId: state.operationRunId,
          operationKey: state.pendingOperation.operationKey,
          signal: context.signal,
        });
        // The transaction's successful result is truthful even if cancellation arrives afterward.
        finishToolEvent(context, 'completed', batch.items);
        if (context.signal.aborted) {
          canceled(context);
          return completeState();
        }
        if (
          batch.items.some((item) => item.sourceKind !== 'personal_record') ||
          validateEvidenceBatch(batch, context.options.execution.allowedScope, state.budget) ||
          utf8ByteLength(canonicalJson(batch)) > state.budget.maxPayloadBytes
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
          combined.items.length > state.budget.maxEvidenceItems ||
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
          evidenceReferences: referencesFromBatch(combined),
          pendingOperation: undefined,
        };
      } catch {
        stop(context, 'The action outcome is unknown; do not repeat it.', 'unavailable');
        return completeState();
      }
    },
  };
}
