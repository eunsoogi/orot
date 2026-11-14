import type { Runtime } from '@langchain/langgraph/web';
import type { MultiAgentWorkflowOptions, EvidenceSearchTool } from './contracts';
import type { RuntimeContext } from './runtimeContext';
import { finishToolEvent, reportProgress } from './runtimeContext';
import type { WorkflowState } from './state';
import { canonicalJson, utf8ByteLength } from './protocol';

/** A host-selected initial lookup is still an external operation, never an approval grant. */
export function validInitialEvidenceSearch<T>(options: MultiAgentWorkflowOptions<T>): boolean {
  const initial = options.initialSearch;
  if (!initial) return true;
  const tool = options.tools.find((value) => value.id === initial.toolId);
  if (
    !tool ||
    tool.execution !== 'external_read_only' ||
    !tool.prepareAuthorizedSearch ||
    !options.checkpointer ||
    !options.operationJournal?.loadPrepared
  )
    return false;
  try {
    const parsed = tool.parseInput(initial.input);
    return (
      !!parsed &&
      canonicalJson(parsed) === canonicalJson(initial.input) &&
      utf8ByteLength(canonicalJson(initial.input)) <= options.execution.budget.maxPayloadBytes
    );
  } catch {
    return false;
  }
}

/** A denied or empty optional preflight does not offer another external query in this run. */
export function availableEvidenceTools<T>(
  options: MultiAgentWorkflowOptions<T>,
  state: WorkflowState,
): readonly EvidenceSearchTool[] {
  return state.initialSearchStatus && !['pending', 'success'].includes(state.initialSearchStatus)
    ? options.tools.filter((tool) => tool.execution !== 'external_read_only')
    : options.tools;
}

/** Reuse the existing journal/authorization boundary; only a known denial may fall back locally. */
export async function executeInitialEvidenceSearch<T>(
  context: RuntimeContext<T>,
  state: WorkflowState,
  runtime: Runtime,
  execute: (state: WorkflowState, runtime: Runtime) => Promise<Partial<WorkflowState>>,
): Promise<Partial<WorkflowState>> {
  const before = context.currentEvidence.items.length;
  const update = await execute(state, runtime);
  if (update.awaitingAuthorization || context.signal.aborted) return update;
  if (context.outcome?.status === 'consent_required') {
    context.outcome = undefined;
    finishToolEvent(context, 'failed');
    reportProgress(context, {
      type: 'evidence_search',
      status: 'completed',
      sourceKind: 'external_medical',
    });
    return {
      phase: 'task_response',
      pendingOperation: undefined,
      awaitingAuthorization: undefined,
      terminal: false,
      initialSearchStatus: 'consent_required',
      selectedToolId: undefined,
    };
  }
  // Unknown dispatch outcomes, invalid sources and storage failures remain terminal.
  if (context.outcome || update.terminal) return update;
  return {
    ...update,
    phase: 'task_response',
    selectedToolId: undefined,
    initialSearchStatus: context.currentEvidence.items.length > before ? 'success' : 'empty',
  };
}

/** Additional counters are admitted only for the one explicit initial search reservation. */
export function validInitialSearchResume<T>(
  saved: import('./contracts').MultiAgentCheckpointState,
  options: MultiAgentWorkflowOptions<T>,
): boolean {
  if (!options.initialSearch) return saved.initialSearchStatus === undefined;
  if (
    !validInitialEvidenceSearch(options) ||
    !['pending', 'success', 'empty', 'consent_required'].includes(saved.initialSearchStatus ?? '')
  )
    return false;
  const tool = options.tools.find((value) => value.id === options.initialSearch!.toolId)!;
  const cost = tool.additionalModelCalls ?? 0;
  if (
    saved.selectedToolId &&
    saved.initialSearchStatus !== 'pending' &&
    saved.initialSearchStatus !== 'success' &&
    options.tools.some(
      (candidate) =>
        candidate.id === saved.selectedToolId && candidate.execution === 'external_read_only',
    )
  )
    return false;
  if (saved.toolCalls < 1 || saved.modelCalls < cost) return false;
  if (saved.initialSearchStatus === 'pending')
    return (
      saved.phase === 'evidence_search' &&
      saved.selectedToolId === tool.id &&
      saved.toolCalls === 1 &&
      saved.modelCalls === cost &&
      saved.researchCycles === 0 &&
      saved.awaitingAuthorization === 'tool-1'
    );
  if (saved.phase === 'task_response' && !saved.awaitingAuthorization)
    return saved.toolCalls === 1 && saved.modelCalls === cost && saved.researchCycles === 0;
  return true;
}

/** Optional initial lookup limits are shown to the first responder, unlike a required research handoff. */
export function requiresCompleteResearch<T>(
  options: MultiAgentWorkflowOptions<T>,
  state: WorkflowState,
) {
  return state.initialSearchStatus !== 'pending' && !options.task.allowIncompleteEvidenceResearch;
}
