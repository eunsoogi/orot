import { END, START, StateGraph } from '@langchain/langgraph/web';
import type {
  MultiAgentCheckpointState,
  AllowedEvidenceScope,
  EvidenceCoverage,
  EvidenceSearchTool,
  MultiAgentInvocation,
  MultiAgentRunResult,
  MultiAgentWorkflowOptions,
} from './contracts';
import { MAX_MULTI_AGENT_BUDGET } from './contracts';
import {
  isSourceAllowed,
  isEvidenceReference,
  isEvidenceReferenceWithinScope,
  projectEvidenceReference,
  referencesFromBatch,
  sameReference,
  validateEvidenceBatch,
} from './evidence';
import { observeUntilAbort } from './modelCall';
import { createNodes } from './nodes';
import { requireTaskContract } from './responses';
import type { PrivateOutcome, RuntimeContext } from './runtimeContext';
import { checkpointMatchesRun, MultiAgentState, routeForPhase } from './state';
import type { WorkflowState } from './state';
import { isOrderedTimestampRange } from './timestamps';

function validEvidenceTool(tool: EvidenceSearchTool, scope: AllowedEvidenceScope): boolean {
  // Network access is reserved for external medical sources; local health and memory tools stay local.
  const executionMatchesSource =
    (tool.execution === 'local_read_only' && tool.sourceKind !== 'external_medical') ||
    (tool.execution === 'external_read_only' && tool.sourceKind === 'external_medical');
  return (
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(tool.id) &&
    executionMatchesSource &&
    isSourceAllowed(scope, tool.sourceKind)
  );
}

export function validBudget<TResult>(options: MultiAgentWorkflowOptions<TResult>): boolean {
  // Require every limit so a malformed runtime config cannot disable one guardrail by omission.
  const keys = Object.keys(MAX_MULTI_AGENT_BUDGET) as (keyof typeof MAX_MULTI_AGENT_BUDGET)[];
  return (
    Object.keys(options.execution.budget).length === keys.length &&
    keys.every((key) => {
      const value = options.execution.budget[key];
      return Number.isSafeInteger(value) && value > 0 && value <= MAX_MULTI_AGENT_BUDGET[key];
    })
  );
}

export function validIdentity<TResult>(options: MultiAgentWorkflowOptions<TResult>): boolean {
  const { execution, provider, task } = options;
  const id = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
  return (
    execution.operationRunId === execution.operationRunId.trim() &&
    id.test(execution.operationRunId) &&
    id.test(execution.providerId) &&
    id.test(execution.modelId) &&
    execution.recipient.trim().length > 0 &&
    provider.id === execution.providerId &&
    requireTaskContract(task) &&
    options.request.trim().length > 0 &&
    execution.allowedScope.sourceKinds.length > 0 &&
    execution.allowedScope.sourceKinds.every((kind) =>
      ['personal_record', 'reviewed_memory', 'external_medical'].includes(kind),
    ) &&
    provider.capabilities.inputTypes.includes('text') &&
    new Set(options.tools.map((tool) => tool.id)).size === options.tools.length &&
    options.tools.every((tool) => validEvidenceTool(tool, execution.allowedScope)) &&
    (!execution.allowedScope.timeRange ||
      isOrderedTimestampRange(
        execution.allowedScope.timeRange.fromInclusive,
        execution.allowedScope.timeRange.toExclusive,
      ))
  );
}

export function initialState<TResult>(options: MultiAgentWorkflowOptions<TResult>): WorkflowState {
  const source = options.execution;
  return {
    operationRunId: source.operationRunId,
    providerId: source.providerId,
    modelId: source.modelId,
    allowedScope: source.allowedScope,
    budget: source.budget,
    phase: 'task_response',
    modelCalls: 0,
    toolCalls: 0,
    researchCycles: 0,
    evidenceReferences: referencesFromBatch(options.initialEvidence),
    evidenceNeed: undefined,
    selectedToolId: undefined,
    pendingOperation: undefined,
    terminal: false,
  };
}

function validResumeShape(saved: MultiAgentCheckpointState): boolean {
  // Durable channel values are input; malformed counts or an in-flight phase cannot safely route.
  return (
    ['task_response', 'evidence_research', 'revised_response'].includes(saved.phase) &&
    [saved.modelCalls, saved.toolCalls, saved.researchCycles].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    ) &&
    saved.terminal === false &&
    saved.pendingOperation === undefined &&
    (saved.evidenceNeed === undefined ||
      ['missing_coverage', 'verify_conflict', 'confirm_value', 'other'].includes(
        saved.evidenceNeed,
      ))
  );
}

export function resumeState<TResult>(
  saved: NonNullable<MultiAgentInvocation['resumeFrom']>,
  options: MultiAgentWorkflowOptions<TResult>,
): WorkflowState | undefined {
  // A checkpoint taken during a side effect cannot prove whether that operation already completed.
  // Reject out-of-scope references before any revalidation or restoration callback can resolve them.
  if (
    !validResumeShape(saved) ||
    !checkpointMatchesRun(saved, options.execution) ||
    !Array.isArray(saved.evidenceReferences) ||
    saved.evidenceReferences.some(
      (reference) =>
        !isEvidenceReference(reference) ||
        !isEvidenceReferenceWithinScope(reference, options.execution.allowedScope),
    ) ||
    saved.modelCalls > options.execution.budget.maxModelCalls ||
    saved.toolCalls > options.execution.budget.maxToolCalls ||
    saved.researchCycles > options.execution.budget.maxResearchCycles ||
    saved.evidenceReferences.length > options.execution.budget.maxEvidenceItems ||
    (saved.phase === 'evidence_research' && !saved.evidenceNeed) ||
    (saved.phase === 'task_response' &&
      (saved.modelCalls > 0 || saved.toolCalls > 0 || saved.researchCycles > 0)) ||
    (saved.phase === 'revised_response' &&
      (saved.toolCalls === 0 || saved.evidenceReferences.length === 0)) ||
    (saved.selectedToolId !== undefined &&
      !options.tools.some((tool) => tool.id === saved.selectedToolId))
  ) {
    return undefined;
  }
  return {
    ...saved,
    evidenceReferences: saved.evidenceReferences.map(projectEvidenceReference),
    evidenceNeed: saved.evidenceNeed,
    selectedToolId: saved.selectedToolId,
    pendingOperation: undefined,
    terminal: false,
  };
}

export async function restoreRunEvidence<TResult>(
  options: MultiAgentWorkflowOptions<TResult>,
  state: WorkflowState,
  signal: AbortSignal,
): Promise<MultiAgentWorkflowOptions<TResult>['initialEvidence'] | undefined> {
  // Resume only after current source revisions match; checkpoint references never restore content.
  const refs = state.evidenceReferences;
  if (refs.length === 0) return { items: [], coverage: [], conflicts: [] };
  if (!options.restoreEvidence) return undefined;
  const freshness = await observeUntilAbort(options.revalidateEvidence(refs, signal), signal);
  if (freshness.kind !== 'value' || !freshness.value) return undefined;
  const restoration = await observeUntilAbort(options.restoreEvidence(refs, signal), signal);
  if (restoration.kind !== 'value') return undefined;
  const restored = restoration.value;
  if (validateEvidenceBatch(restored, options.execution.allowedScope, options.execution.budget))
    return undefined;
  const current = referencesFromBatch(restored);
  return current.length === refs.length &&
    refs.every((ref) => current.some((item) => sameReference(ref, item)))
    ? restored
    : undefined;
}

export function makeGraph<TResult>(
  context: RuntimeContext<TResult>,
  checkpointer?: MultiAgentWorkflowOptions<TResult>['checkpointer'],
) {
  const nodes = createNodes(context);
  const routeMap = {
    task_response: 'prepareResponder',
    research: 'prepareResearcher',
    search: 'prepareSearch',
    revision: 'prepareRevision',
    stop: END,
  } as const;
  const route = (state: WorkflowState) => routeForPhase(state.phase);
  return new StateGraph(MultiAgentState)
    .addNode('prepareResponder', (state) => nodes.prepareResponder(state))
    .addNode('invokeResponder', nodes.invokeResponder)
    .addNode('prepareResearcher', nodes.prepareResearcher)
    .addNode('invokeResearcher', nodes.invokeResearcher)
    .addNode('prepareSearch', nodes.prepareSearch)
    .addNode('executeSearch', nodes.executeSearch)
    .addNode('prepareRevision', (state) => nodes.prepareRevision(state))
    .addNode('invokeRevision', nodes.invokeRevision)
    .addConditionalEdges(START, route, routeMap)
    .addConditionalEdges('prepareResponder', (state) => (state.terminal ? END : 'invokeResponder'))
    .addConditionalEdges('invokeResponder', route, routeMap)
    .addConditionalEdges('prepareResearcher', (state) =>
      state.terminal ? END : 'invokeResearcher',
    )
    .addConditionalEdges('invokeResearcher', route, routeMap)
    .addConditionalEdges('prepareSearch', (state) => (state.terminal ? END : 'executeSearch'))
    .addConditionalEdges('executeSearch', route, routeMap)
    .addConditionalEdges('prepareRevision', (state) => (state.terminal ? END : 'invokeRevision'))
    .addEdge('invokeRevision', END)
    .compile({ checkpointer });
}

export function publicResult<TResult>(
  outcome: PrivateOutcome<TResult>,
  coverage: readonly EvidenceCoverage[],
  checkpoint: MultiAgentCheckpointState,
): MultiAgentRunResult<TResult> {
  if (outcome.status === 'result') return { ...outcome, coverage, checkpoint };
  if (outcome.status === 'cancelled')
    return { ...outcome, downstreamDispatchStopped: true, checkpoint };
  return { ...outcome, checkpoint };
}

export function failureResult<TResult>(
  outcome: PrivateOutcome<TResult>,
  checkpoint: MultiAgentCheckpointState,
): MultiAgentRunResult<TResult> {
  if (outcome.status === 'result') return { ...outcome, coverage: [], checkpoint };
  if (outcome.status === 'cancelled')
    return { ...outcome, downstreamDispatchStopped: true, checkpoint };
  return { ...outcome, checkpoint };
}
