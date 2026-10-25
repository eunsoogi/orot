import { hasBlockingCoverage } from './coveragePolicy';
import type { EvidenceBatch, EvidenceReference } from './contracts';
import { referencesFromBatch, validateEvidenceBatch } from './evidence';
import { observeUntilAbort } from './modelCall';
import { canceled, completeState, reportProgress, stop } from './runtimeContext';
import type { RuntimeContext } from './runtimeContext';
import type { WorkflowState } from './state';
import { canonicalJson, utf8ByteLength } from './protocol';
import { invokePreparedEvidenceSearch, prepareEvidenceSearch } from './prepareEvidenceSearch';
import { toolProviderStop } from './evidenceToolModelBudget';

// Search remains read-only; the external adapter verifies the declared outbound permission before networking.
export function createSearchNodes<TResult>(context: RuntimeContext<TResult>) {
  const { options } = context;

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
    reportProgress(context, {
      type: 'evidence_search',
      status: 'started',
      sourceKind: tool.sourceKind,
    });
    let batch: EvidenceBatch;
    try {
      const searched = await observeUntilAbort(
        invokePreparedEvidenceSearch(context, state, tool),
        context.signal,
      );
      if (searched.kind === 'cancelled') {
        canceled(context, toolProviderStop(tool));
        return completeState();
      }
      if (searched.kind === 'error') {
        stop(context, 'The allowlisted evidence search failed.', 'unavailable');
        return completeState();
      }
      if (searched.value.status === 'cancelled') {
        canceled(context, searched.value.providerStop ?? toolProviderStop(tool));
        return completeState();
      }
      if (searched.value.status !== 'result') {
        stop(
          context,
          searched.value.status === 'consent_required'
            ? 'User approval is required before the external evidence query can run.'
            : 'The allowlisted evidence search did not produce valid current evidence.',
          searched.value.status === 'invalid_input' ? 'invalid_output' : searched.value.status,
        );
        return completeState();
      }
      batch = searched.value.batch;
    } catch {
      if (context.signal.aborted) canceled(context, toolProviderStop(tool));
      else stop(context, 'The allowlisted evidence search failed.', 'unavailable');
      return completeState();
    }
    reportProgress(context, {
      type: 'evidence_search',
      status: 'completed',
      sourceKind: tool.sourceKind,
    });
    if (context.signal.aborted) {
      canceled(context, toolProviderStop(tool));
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
    // The standard transport sorts object keys. Compare projected references canonically
    // so locator key order cannot make an already-seen source revision appear new.
    const priorKeys = new Set(prior.map(serializedReferenceKey));
    const hasDuplicate = next.some((reference) => priorKeys.has(serializedReferenceKey(reference)));
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
    // Even an empty or incomplete search is a tool result. Let the model see it;
    // final coverage and citation validation still prevent unsupported answers.
    if (context.pendingNativeToolCallId) {
      const combined = {
        items: [...context.currentEvidence.items, ...batch.items],
        coverage: [...context.currentEvidence.coverage, ...batch.coverage],
        conflicts: [...context.currentEvidence.conflicts, ...batch.conflicts],
      };
      if (hasDuplicate) {
        stop(context, 'The tool returned duplicate evidence.', 'invalid_output');
        return completeState();
      }
      if (combined.items.length && !(await evidenceIsFresh(context, combined)))
        return completeState();
      context.currentEvidence = combined;
      context.nativeToolMessages?.push({
        role: 'tool',
        toolCallId: context.pendingNativeToolCallId,
        // The full batch was size/scope/freshness checked and remains in currentEvidence.
        // Rebuilt tasks can expose facts once; callback identity and coverage remain intact.
        result: JSON.parse(
          JSON.stringify(
            options.task.nativeToolResultMode === 'evidence_references'
              ? {
                  contentLocation: 'current_task_messages',
                  evidenceIds: batch.items.map((item) => item.evidenceId),
                  coverage: batch.coverage,
                  conflicts: batch.conflicts,
                }
              : batch,
          ),
        ),
      });
      context.pendingNativeToolCallId = undefined;
      return {
        phase: 'revised_response' as const,
        evidenceReferences: referencesFromBatch(combined),
        pendingOperation: undefined,
      };
    }
    if (next.length === 0 || hasDuplicate) {
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
    if (
      hasBlockingCoverage(
        combined,
        context.options.task.allowBoundedExternalEvidence,
        context.options.task.allowRankedLocalEvidence,
      )
    ) {
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

  return {
    prepareSearch: (state: WorkflowState) => prepareEvidenceSearch(context, state),
    executeSearch,
  };
}

/** Identity ignores object key order and JSON-omitted optional properties, while
 * retaining all projected provenance fields and the order of locator arrays. */
function serializedReferenceKey(reference: EvidenceReference): string {
  return canonicalJson(JSON.parse(JSON.stringify(reference)));
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
