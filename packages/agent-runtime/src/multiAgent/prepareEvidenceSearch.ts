import { canceled, completeState, operationKey, stop } from './runtimeContext';
import type { RuntimeContext } from './runtimeContext';
import type { WorkflowState } from './state';
import { canReserveToolModelCall } from './evidenceToolModelBudget';
import type { BaseStore } from '@langchain/langgraph/web';
import { createLangChainEvidenceTool } from '../langchain/evidenceTool';
import type { EvidenceSearchReservation } from '../langchain/evidenceTool';
import type { EvidenceBatch, EvidenceSearchTool, ProviderStopObservation } from './contracts';

type PreparedSearchResult =
  | { readonly status: 'result'; readonly batch: EvidenceBatch }
  | (Extract<EvidenceSearchReservation, { status: string }> & {
      readonly providerStop?: ProviderStopObservation;
    });

/** Persist the full declared cost before entering the read-only adapter. A crash
 * during its delegated request stays an uncertain pending tool operation and cannot replay. */
export function prepareEvidenceSearch<TResult>(
  context: RuntimeContext<TResult>,
  state: WorkflowState,
) {
  if (context.signal.aborted) {
    canceled(context);
    return completeState();
  }
  const tool = context.options.tools.find((candidate) => candidate.id === state.selectedToolId);
  if (
    !tool ||
    !context.researchInput ||
    state.toolCalls >= state.budget.maxToolCalls ||
    state.evidenceReferences.length >= state.budget.maxEvidenceItems ||
    !canReserveToolModelCall(tool, state)
  ) {
    stop(context, 'The read-only evidence search could not be started.', 'budget_exceeded');
    return completeState();
  }
  return {
    phase: 'evidence_search' as const,
    modelCalls: state.modelCalls + (tool.additionalModelCalls ?? 0),
    toolCalls: state.toolCalls + 1,
    pendingOperation: {
      kind: 'tool' as const,
      operationKey: operationKey('tool', state.toolCalls + 1),
    },
  };
}

/** Invoke with host-only capabilities. The graph already checkpointed the shared cost;
 * consuming that reservation must not spend another tool or delegated-model slot. */
export async function invokePreparedEvidenceSearch<TResult>(
  context: RuntimeContext<TResult>,
  state: WorkflowState,
  tool: EvidenceSearchTool,
  store?: BaseStore,
): Promise<PreparedSearchResult> {
  const pending = state.pendingOperation;
  const input = context.researchInput;
  if (pending?.kind !== 'tool' || !input) return { status: 'stale_evidence' };
  let searchedBatch: EvidenceBatch | undefined;
  const invocationTool: EvidenceSearchTool = {
    id: tool.id,
    description: tool.description,
    sourceKind: tool.sourceKind,
    execution: tool.execution,
    inputSchema: tool.inputSchema,
    additionalModelCalls: tool.additionalModelCalls,
    // Preserve the domain receiver even when a service implements methods on its prototype.
    parseInput: (value) => tool.parseInput(value),
    search: async (request, runtime) => {
      const outcome = await tool.search(request, runtime);
      if ('status' in outcome) return outcome;
      // Optional undefined fields are absent in JSON. Retain insertion order for
      // existing range/reference comparisons and checkpoint restoration after validation.
      searchedBatch = JSON.parse(JSON.stringify(outcome)) as EvidenceBatch;
      return searchedBatch;
    },
  };
  const standardTool = createLangChainEvidenceTool(invocationTool, {
    signal: context.signal,
    timedOut: context.timedOut,
    reserveSearch: () => ({
      operationRunId: context.options.execution.operationRunId,
      operationKey: pending.operationKey,
      allowedScope: context.options.execution.allowedScope,
      // Successive results consume the same evidence capacity, including existing references.
      resultLimit: state.budget.maxEvidenceItems - state.evidenceReferences.length,
      maxPayloadBytes: state.budget.maxPayloadBytes,
    }),
    revalidateEvidence: (references, signal) =>
      context.options.revalidateEvidence(references, signal),
    store,
  });
  // Plain arguments keep native message conversion at its existing boundary. No graph
  // runnable config enters this private invocation, so query/evidence callbacks stay disabled.
  const result = JSON.parse(await standardTool.invoke(input)) as PreparedSearchResult;
  // Only a successful standard invocation releases the exact JSON data it validated.
  // Its canonical transport ordering must not rewrite the graph's domain representation.
  if (result.status !== 'result') return result;
  return searchedBatch ? { status: 'result', batch: searchedBatch } : { status: 'invalid_output' };
}
