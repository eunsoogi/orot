import type {
  MultiAgentExecutionIdentity,
  EvidenceSearchTool,
  TaskResponderInput,
} from './contracts';
import type { WorkflowState } from './state';
import { isSourceAllowed } from './evidence';
import { EUROPE_PMC_SOURCE_ID, EUROPE_PMC_TOOL_ID } from './literatureQueryGuidance';

/** Native tools need one remaining answer; legacy research also reserves a planner. */
export function responderResearchAvailability(
  execution: MultiAgentExecutionIdentity,
  tools: readonly EvidenceSearchTool[],
  state: WorkflowState,
  revised = false,
  nativeTools = false,
): NonNullable<TaskResponderInput['research']> {
  const allowedScope = execution.allowedScope;
  const candidateTools = tools
    .filter(
      (tool) =>
        isSourceAllowed(allowedScope, tool.sourceKind) &&
        (tool.additionalModelCalls === undefined ||
          state.modelCalls + tool.additionalModelCalls + (nativeTools ? 1 : 2) <=
            state.budget.maxModelCalls) &&
        allowedScope.sourceIds?.length !== 0 &&
        (tool.id !== EUROPE_PMC_TOOL_ID ||
          (allowedScope.timeRange === undefined &&
            isSourceAllowed(allowedScope, 'external_medical', EUROPE_PMC_SOURCE_ID))),
    )
    .map(({ id, sourceKind, execution: toolExecution, additionalModelCalls }) => ({
      id,
      sourceKind,
      execution: toolExecution,
      ...(additionalModelCalls === undefined ? {} : { additionalModelCalls }),
    }));
  const remainingModelCalls = Math.max(0, state.budget.maxModelCalls - state.modelCalls);
  const remainingToolCalls = Math.max(0, state.budget.maxToolCalls - state.toolCalls);
  const remainingResearchCycles =
    revised && !nativeTools
      ? 0
      : Math.max(0, state.budget.maxResearchCycles - state.researchCycles);
  return {
    canRequestEvidence:
      candidateTools.length > 0 &&
      remainingModelCalls >= (nativeTools ? 1 : 2) &&
      remainingToolCalls > 0 &&
      (nativeTools || remainingResearchCycles > 0) &&
      state.evidenceReferences.length < state.budget.maxEvidenceItems,
    allowedScope,
    candidateTools,
    remainingModelCalls,
    remainingToolCalls,
    remainingResearchCycles,
  };
}
