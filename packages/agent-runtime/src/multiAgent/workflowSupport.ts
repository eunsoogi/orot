import { restoreOrderedEvidenceBatches } from './evidenceRestoration';
import { validInitialEvidenceSearch, validInitialSearchResume } from './initialEvidenceSearch';
import { validResumeShape } from './resumeShape';
import { actionContract, validLocalActions } from './actionContracts';
import type {
  MultiAgentCheckpointState,
  AllowedEvidenceScope,
  EvidenceCoverage,
  EvidenceSearchTool,
  MultiAgentInvocation,
  MultiAgentRunResult,
  MultiAgentWorkflowOptions,
} from './contracts';
export { validBudget } from './budgetValidation';
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
import { requireTaskContract } from './responses';
import type { PrivateOutcome } from './runtimeContext';
import { checkpointMatchesRun } from './state';
import type { WorkflowState } from './state';
import { isOrderedTimestampRange } from './timestamps';
import { validToolModelCost } from './evidenceToolModelBudget';
import { validPhotoInput } from './photoInputValidation';

function validEvidenceTool(tool: EvidenceSearchTool, scope: AllowedEvidenceScope): boolean {
  // Network access is reserved for external medical sources; local health and memory tools stay local.
  const executionMatchesSource =
    (tool.execution === 'local_read_only' && tool.sourceKind !== 'external_medical') ||
    (tool.execution === 'external_read_only' && tool.sourceKind === 'external_medical');
  return (
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(tool.id) &&
    executionMatchesSource &&
    validToolModelCost(tool) &&
    isSourceAllowed(scope, tool.sourceKind)
  );
}

export function validIdentity<TResult>(options: MultiAgentWorkflowOptions<TResult>): boolean {
  const { execution, provider, task } = options;
  const id = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
  const evidenceOnly = validPhotoInput(options);
  return (
    execution.operationRunId === execution.operationRunId.trim() &&
    id.test(execution.operationRunId) &&
    id.test(execution.providerId) &&
    id.test(execution.modelId) &&
    execution.recipient.trim().length > 0 &&
    provider.id === execution.providerId &&
    requireTaskContract(task) &&
    validInitialEvidenceSearch(options) &&
    (!options.photoInput || evidenceOnly) &&
    (options.request.trim().length > 0 || evidenceOnly) &&
    execution.allowedScope.sourceKinds.length > 0 &&
    execution.allowedScope.sourceKinds.every((kind) =>
      ['personal_record', 'reviewed_memory', 'generated_artifact', 'external_medical'].includes(
        kind,
      ),
    ) &&
    provider.capabilities.inputTypes.includes('text') &&
    new Set(options.tools.map((tool) => tool.id)).size === options.tools.length &&
    options.tools.every((tool) => validEvidenceTool(tool, execution.allowedScope)) &&
    validLocalActions(options.actions, execution.allowedScope) &&
    new Set([
      ...options.tools.map((tool) => tool.id),
      ...(options.actions ?? []).map((action) => action.id),
    ]).size ===
      options.tools.length + (options.actions?.length ?? 0) &&
    (!execution.allowedScope.timeRange ||
      isOrderedTimestampRange(
        execution.allowedScope.timeRange.fromInclusive,
        execution.allowedScope.timeRange.toExclusive,
      ))
  );
}

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function initialState<TResult>(options: MultiAgentWorkflowOptions<TResult>): WorkflowState {
  const source = options.execution;
  return {
    actionContract: actionContract(options.actions),
    committedAction: false,
    operationRunId: source.operationRunId,
    providerId: source.providerId,
    modelId: source.modelId,
    allowedScope: source.allowedScope,
    budget: source.budget,
    phase: options.initialSearch ? 'evidence_search' : 'task_response',
    modelCalls: 0,
    toolCalls: 0,
    researchCycles: 0,
    evidenceReferences: referencesFromBatch(options.initialEvidence),
    evidenceNeed: undefined,
    selectedToolId: options.initialSearch?.toolId,
    initialSearchStatus: options.initialSearch ? 'pending' : undefined,
    pendingOperation: undefined,
    awaitingAuthorization: undefined,
    terminal: false,
  };
}

export function resumeState<TResult>(
  saved: NonNullable<MultiAgentInvocation['resumeFrom']>,
  options: MultiAgentWorkflowOptions<TResult>,
): WorkflowState | undefined {
  // A checkpoint taken during a side effect cannot prove whether that operation already completed.
  // Reject out-of-scope references before any revalidation or restoration callback can resolve them.
  if (
    saved.actionContract !== actionContract(options.actions) ||
    // Live-only release: never reconstruct a committed mutation without the protected result journal.
    (saved.committedAction !== undefined && saved.committedAction !== false) ||
    !validResumeShape(saved) ||
    !validInitialSearchResume(saved, options) ||
    !checkpointMatchesRun(saved, options.execution) ||
    !Array.isArray(saved.evidenceReferences) ||
    saved.evidenceReferences.some(
      (reference) =>
        !isEvidenceReference(reference) ||
        !isEvidenceReferenceWithinScope(reference, options.execution.allowedScope),
    ) ||
    saved.terminal ||
    saved.phase === 'complete' ||
    saved.pendingOperation ||
    (saved.awaitingAuthorization !== undefined &&
      (!options.operationJournal?.loadPrepared ||
        (saved.phase === 'evidence_search'
          ? saved.toolCalls < 1 ||
            saved.awaitingAuthorization !== `tool-${saved.toolCalls}` ||
            !options.tools.some(
              (tool) =>
                tool.id === saved.selectedToolId &&
                tool.execution === 'external_read_only' &&
                typeof tool.prepareAuthorizedSearch === 'function',
            )
          : saved.modelCalls < 1 ||
            saved.awaitingAuthorization !== `model-${saved.modelCalls}`))) ||
    (saved.phase === 'evidence_search' && !saved.awaitingAuthorization) ||
    saved.phase === 'local_action' ||
    !isNonNegativeSafeInteger(saved.modelCalls) ||
    !isNonNegativeSafeInteger(saved.toolCalls) ||
    !isNonNegativeSafeInteger(saved.researchCycles) ||
    saved.modelCalls > options.execution.budget.maxModelCalls ||
    saved.toolCalls > options.execution.budget.maxToolCalls ||
    saved.researchCycles > options.execution.budget.maxResearchCycles ||
    saved.evidenceReferences.length > options.execution.budget.maxEvidenceItems ||
    (saved.phase === 'evidence_research' && !saved.evidenceNeed) ||
    (saved.phase === 'task_response' &&
      !saved.awaitingAuthorization &&
      !saved.initialSearchStatus &&
      (saved.modelCalls > 0 || saved.toolCalls > 0 || saved.researchCycles > 0)) ||
    // An empty completed tool batch may still have a prepared, never-dispatched model approval.
    // Without that exact journal-backed wait, zero-reference revision checkpoints remain unsafe.
    (saved.phase === 'revised_response' &&
      (saved.toolCalls === 0 ||
        (saved.evidenceReferences.length === 0 && !saved.awaitingAuthorization))) ||
    (saved.selectedToolId !== undefined &&
      ![...options.tools, ...(options.actions ?? [])].some(
        (tool) => tool.id === saved.selectedToolId,
      ))
  ) {
    return undefined;
  }
  return {
    ...saved,
    initialSearchStatus: saved.initialSearchStatus,
    awaitingAuthorization: saved.awaitingAuthorization,
    actionContract: saved.actionContract,
    committedAction: saved.committedAction,
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
  // An empty search still has coverage and gaps. A registered restorer owns that
  // metadata too; never replace its result with a fabricated unsearched batch.
  if (!options.restoreEvidence && !options.restoreEvidenceBatches)
    return refs.length === 0 ? { items: [], coverage: [], conflicts: [] } : undefined;
  if (refs.length > 0) {
    const freshness = await observeUntilAbort(options.revalidateEvidence(refs, signal), signal);
    if (freshness.kind !== 'value' || !freshness.value) return undefined;
  }
  if (options.restoreEvidenceBatches) return restoreOrderedEvidenceBatches(options, refs, signal);
  const restoration = await observeUntilAbort(options.restoreEvidence!(refs, signal), signal);
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

export { makeGraph } from './workflowGraph';

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
