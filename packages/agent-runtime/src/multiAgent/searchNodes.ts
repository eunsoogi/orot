import type { EvidenceBatch } from './contracts';
import {
  hasIncompleteCoverage,
  referencesFromBatch,
  sameReference,
  validateEvidenceBatch,
} from './evidence';
import { observeUntilAbort } from './modelCall';
import { canceled, completeState, operationKey, stop } from './runtimeContext';
import type { RuntimeContext } from './runtimeContext';
import type { WorkflowState } from './state';
import { canonicalJson, utf8ByteLength } from './protocol';

// Search is a deterministic local read; the model only selects its allowlisted ID and typed input.
export function createSearchNodes<TResult>(context: RuntimeContext<TResult>) {
  const { options } = context;

  const prepareSearch = async (state: WorkflowState) => {
    if (context.signal.aborted) {
      canceled(context);
      return completeState();
    }
    if (
      !state.selectedToolId ||
      !context.researchInput ||
      state.toolCalls >= state.budget.maxToolCalls
    ) {
      stop(context, 'The read-only evidence search could not be started.', 'budget_exceeded');
      return completeState();
    }
    return {
      phase: 'evidence_search' as const,
      toolCalls: state.toolCalls + 1,
      pendingOperation: {
        kind: 'tool' as const,
        operationKey: operationKey('tool', state.toolCalls + 1),
      },
    };
  };

  const executeSearch = async (state: WorkflowState) => {
    if (context.signal.aborted) {
      canceled(context);
      return completeState();
    }
    const tool = options.tools.find((candidate) => candidate.id === state.selectedToolId);
    if (!tool || !context.researchInput || state.pendingOperation?.kind !== 'tool') {
      stop(
        context,
        'The checkpoint did not contain a safe evidence-search handoff.',
        'stale_evidence',
      );
      return completeState();
    }
    let batch: EvidenceBatch;
    try {
      const searched = await observeUntilAbort(
        tool.search({
          operationRunId: options.execution.operationRunId,
          operationKey: state.pendingOperation.operationKey,
          input: context.researchInput,
          allowedScope: options.execution.allowedScope,
          resultLimit: state.budget.maxEvidenceItems,
          maxPayloadBytes: state.budget.maxPayloadBytes,
          signal: context.signal,
        }),
        context.signal,
      );
      if (searched.kind === 'cancelled') {
        canceled(context);
        return completeState();
      }
      if (searched.kind === 'error') {
        stop(context, 'The allowlisted evidence search failed.', 'unavailable');
        return completeState();
      }
      batch = searched.value;
    } catch {
      if (context.signal.aborted) canceled(context);
      else stop(context, 'The allowlisted evidence search failed.', 'unavailable');
      return completeState();
    }
    if (context.signal.aborted) {
      canceled(context);
      return completeState();
    }
    context.researchInput = undefined;
    const invalid = validateEvidenceBatch(batch, options.execution.allowedScope, state.budget);
    if (utf8ByteLength(canonicalJson(batch)) > state.budget.maxPayloadBytes) {
      stop(context, 'The evidence result exceeded the payload limit.', 'budget_exceeded');
      return completeState();
    }
    const prior = referencesFromBatch(context.currentEvidence);
    const next = referencesFromBatch(batch);
    if (
      invalid ||
      batch.items.some((item) => item.sourceKind !== tool.sourceKind) ||
      batch.coverage.length === 0 ||
      batch.coverage.some((coverage) => coverage.sourceKind !== tool.sourceKind)
    ) {
      stop(
        context,
        invalid ?? 'The evidence search did not produce new, scoped evidence.',
        'invalid_output',
      );
      return completeState();
    }
    if (prior.length + next.length > state.budget.maxEvidenceItems) {
      stop(context, 'The evidence item budget was exceeded.', 'budget_exceeded');
      return completeState();
    }
    if (
      next.length === 0 ||
      next.some((reference) => prior.some((existing) => sameReference(existing, reference)))
    ) {
      context.outcome = {
        status: 'needs_clarification',
        reason: 'The search did not add new evidence at a newer source revision.',
        coverage: [...context.currentEvidence.coverage, ...batch.coverage],
      };
      return { ...completeState(), evidenceReferences: prior };
    }
    const combined = {
      items: [...context.currentEvidence.items, ...batch.items],
      coverage: [...context.currentEvidence.coverage, ...batch.coverage],
      conflicts: [...context.currentEvidence.conflicts, ...batch.conflicts],
    };
    if (!(await evidenceIsFresh(context, combined))) return completeState();
    context.currentEvidence = combined;
    if (hasIncompleteCoverage(combined)) {
      context.outcome = {
        status: 'needs_clarification',
        reason: 'The available evidence has gaps, conflicts, or truncation.',
        coverage: combined.coverage,
      };
      return { ...completeState(), evidenceReferences: referencesFromBatch(combined) };
    }
    return {
      phase: 'revised_response' as const,
      evidenceReferences: referencesFromBatch(combined),
      pendingOperation: undefined,
    };
  };

  return { prepareSearch, executeSearch };
}

async function evidenceIsFresh<TResult>(
  context: RuntimeContext<TResult>,
  batch: EvidenceBatch,
): Promise<boolean> {
  try {
    const observed = await observeUntilAbort(
      context.options.revalidateEvidence(referencesFromBatch(batch), context.signal),
      context.signal,
    );
    if (observed.kind === 'cancelled') {
      canceled(context);
      return false;
    }
    if (observed.kind === 'error') {
      stop(context, 'Evidence freshness could not be confirmed.', 'stale_evidence');
      return false;
    }
    if (observed.value) return true;
    stop(context, 'One or more evidence sources changed during the run.', 'stale_evidence');
  } catch {
    if (context.signal.aborted) canceled(context);
    else stop(context, 'Evidence freshness could not be confirmed.', 'stale_evidence');
  }
  return false;
}
