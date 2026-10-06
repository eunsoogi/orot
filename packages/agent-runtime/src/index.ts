import { Annotation, END, START, StateGraph } from '@langchain/langgraph/web';
export { createLanguageModelProviderGraph } from './modelProviderGraph';
export {
  createLocalRecordQueryService,
  LOCAL_MEMORY_MAX_RESULTS,
  LOCAL_OBSERVATION_QUERY_TYPES,
  LOCAL_QUERY_MAX_RANGE_MS,
  LOCAL_QUERY_MAX_ROWS,
} from './localRecordQueryService';
export { createLocalRecordQueryTools } from './localRecordQueryTools';
export { SqliteCheckpointSaver } from './sqliteCheckpointSaver';
export { runMultiAgentWorkflow } from './multiAgent/workflow';
export {
  createLocalObservationEvidenceTool,
  createLocalTranscriptEvidenceTool,
} from './multiAgent/localQueryEvidence';
export type {
  AllowedEvidenceScope,
  ConsentDecision,
  EvidenceBatch,
  EvidenceCoverage,
  EvidenceItem,
  EvidenceNeed,
  EvidenceReference,
  EvidenceSearchRequest,
  EvidenceSearchTool,
  EvidenceSourceKind,
  ExecutionConsentPort,
  MultiAgentBudget,
  MultiAgentCheckpointState,
  MultiAgentExecutionIdentity,
  MultiAgentInvocation,
  MultiAgentPhase,
  MultiAgentRunResult,
  MultiAgentWorkflowOptions,
  OutboundProcessingRequest,
  TaskResponderContract,
  TaskResponderInput,
  TaskResultValidation,
} from './multiAgent/contracts';
export { DEFAULT_MULTI_AGENT_BUDGET, MAX_MULTI_AGENT_BUDGET } from './multiAgent/contracts';

export type {
  LocalAppointmentQueryResult,
  LocalMemoryHit,
  LocalMemoryQueryResult,
  LocalMemoryReader,
  LocalMedicationQueryResult,
  LocalObservationQueryType,
  LocalQueryResult,
  LocalQueryWindow,
  LocalRecordQueryService,
  LocalRecordQueryStorage,
  LocalStaleTranscriptArtifact,
  LocalTranscriptQueryResult,
} from './localRecordQueryService';

export type AgentGraphNode = 'increment' | 'double';

export type AgentGraphState = {
  value: number;
  nodeRuns: AgentGraphNode[];
};

const State = Annotation.Root({
  value: Annotation<number>(),
  nodeRuns: Annotation<AgentGraphNode[]>({
    reducer: (current, update) => current.concat(update),
    default: () => [],
  }),
});

function createStatefulGraphBuilder() {
  return new StateGraph(State)
    .addNode('increment', (state) => ({
      value: state.value + 1,
      nodeRuns: ['increment'],
    }))
    .addNode('double', (state) => ({
      value: state.value * 2,
      nodeRuns: ['double'],
    }))
    .addEdge(START, 'increment')
    .addEdge('increment', 'double')
    .addEdge('double', END);
}

type StatefulGraphCompileOptions = Parameters<
  ReturnType<typeof createStatefulGraphBuilder>['compile']
>[0];

export function createStatefulTwoNodeGraph(options?: StatefulGraphCompileOptions) {
  return createStatefulGraphBuilder().compile(options);
}
