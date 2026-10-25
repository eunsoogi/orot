import { Annotation } from '@langchain/langgraph/web';
import type {
  AllowedEvidenceScope,
  EvidenceNeed,
  EvidenceReference,
  MultiAgentBudget,
  MultiAgentCheckpointState,
  MultiAgentPhase,
} from './contracts';
import { projectEvidenceReference } from './evidence';

export type WorkflowRoute = 'task_response' | 'research' | 'search' | 'revision' | 'stop';

// Graph channels intentionally exclude user text, source content, queries, and model output.
export const MultiAgentState = Annotation.Root({
  operationRunId: Annotation<string>(),
  providerId: Annotation<string>(),
  modelId: Annotation<string>(),
  allowedScope: Annotation<AllowedEvidenceScope>(),
  budget: Annotation<MultiAgentBudget>(),
  phase: Annotation<MultiAgentPhase>(),
  modelCalls: Annotation<number>(),
  toolCalls: Annotation<number>(),
  researchCycles: Annotation<number>(),
  evidenceReferences: Annotation<EvidenceReference[]>(),
  evidenceNeed: Annotation<EvidenceNeed | undefined>({
    value: (_current, update) => update,
    default: () => undefined,
  }),
  selectedToolId: Annotation<string | undefined>({
    value: (_current, update) => update,
    default: () => undefined,
  }),
  pendingOperation: Annotation<MultiAgentCheckpointState['pendingOperation']>({
    value: (_current, update) => update,
    default: () => undefined,
  }),
  terminal: Annotation<boolean>(),
});

export type WorkflowState = typeof MultiAgentState.State;

export function routeForPhase(phase: MultiAgentPhase): WorkflowRoute {
  switch (phase) {
    case 'task_response':
      return 'task_response';
    case 'evidence_research':
      return 'research';
    case 'evidence_search':
      return 'search';
    case 'revised_response':
      return 'revision';
    case 'complete':
      return 'stop';
  }
}

export function checkpointFromState(state: WorkflowState): MultiAgentCheckpointState {
  return {
    operationRunId: state.operationRunId,
    providerId: state.providerId,
    modelId: state.modelId,
    allowedScope: state.allowedScope,
    budget: state.budget,
    phase: state.phase,
    modelCalls: state.modelCalls,
    toolCalls: state.toolCalls,
    researchCycles: state.researchCycles,
    evidenceReferences: state.evidenceReferences.map(projectEvidenceReference),
    evidenceNeed: state.evidenceNeed,
    selectedToolId: state.selectedToolId,
    pendingOperation: state.pendingOperation,
    terminal: state.terminal,
  };
}

// A failed checkpoint write leaves completion uncertain, so the returned snapshot must never replay.
export function nonResumableCheckpoint(state: WorkflowState): MultiAgentCheckpointState {
  return checkpointFromState({
    ...state,
    phase: 'complete',
    pendingOperation: undefined,
    terminal: true,
  });
}

export function checkpointMatchesRun(
  checkpoint: MultiAgentCheckpointState,
  identity: {
    readonly operationRunId: string;
    readonly providerId: string;
    readonly modelId: string;
    readonly allowedScope: AllowedEvidenceScope;
    readonly budget: MultiAgentBudget;
  },
): boolean {
  return (
    checkpoint.operationRunId === identity.operationRunId &&
    checkpoint.providerId === identity.providerId &&
    checkpoint.modelId === identity.modelId &&
    JSON.stringify(checkpoint.allowedScope) === JSON.stringify(identity.allowedScope) &&
    JSON.stringify(checkpoint.budget) === JSON.stringify(identity.budget)
  );
}
