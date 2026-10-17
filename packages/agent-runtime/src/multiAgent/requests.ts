import type { LanguageModelProvider, LanguageModelRequest } from '@orot/model-runtime';
import { isSourceAllowed } from './evidence';
import {
  EUROPE_PMC_QUERY_GUIDANCE,
  EUROPE_PMC_SOURCE_ID,
  EUROPE_PMC_TOOL_ID,
} from './literatureQueryGuidance';
import type {
  AllowedEvidenceScope,
  EvidenceSearchTool,
  EvidenceNeed,
  MultiAgentBudget,
  TaskResponderContract,
  TaskResponderInput,
  MultiAgentExecutionIdentity,
} from './contracts';
import type { WorkflowState } from './state';
import {
  buildTaskMessages,
  researcherPrompt,
  researcherSchema,
  taskResponseSchema,
} from './protocol';

export type TaskRequestBuild =
  | { readonly status: 'ready'; readonly request: LanguageModelRequest }
  | { readonly status: 'invalid' | 'unsupported_input' };

// Capability flags select provider features; response parsing and task validation remain local.
export function buildTaskRequest<TResult>(
  provider: LanguageModelProvider,
  contract: TaskResponderContract<TResult>,
  input: TaskResponderInput,
  budget: MultiAgentBudget,
  correctionInstruction?: string,
): TaskRequestBuild {
  try {
    // Corrections are final responses in the graph, so they cannot advertise another research handoff.
    const effectiveInput =
      correctionInstruction && input.research
        ? {
            ...input,
            research: {
              ...input.research,
              canRequestEvidence: false,
              remainingResearchCycles: 0,
              remainingModelCalls: Math.max(0, input.research.remainingModelCalls - 1),
            },
          }
        : input;
    const taskMessages = buildTaskMessages(
      contract,
      effectiveInput,
      provider.capabilities.structuredOutput,
    );
    const messages =
      taskMessages && correctionInstruction
        ? [...taskMessages, { role: 'user' as const, content: correctionInstruction }]
        : taskMessages;
    if (!messages || !messages.some((message) => message.role === 'user'))
      return { status: 'invalid' };
    const supportsMessages = messages.every((message) => {
      if (message.role === 'tool') return false;
      if (typeof message.content === 'string')
        return provider.capabilities.inputTypes.includes('text');
      return message.content.every((part) => provider.capabilities.inputTypes.includes(part.type));
    });
    if (!supportsMessages) return { status: 'unsupported_input' };
    const request: LanguageModelRequest = {
      messages: [
        {
          role: 'system',
          content: [
            contract.systemPrompt,
            'When the supplied evidence supports the task, return type=result with value matching the task schema and citations containing the used evidenceId strings.',
            'Use type=request_evidence only if the task permits more research and a specific missing fact prevents a supported result.',
            'Preserve task-defined uncertainty and clarification outcomes. Do not request evidence merely because a result is uncertain.',
            ...(effectiveInput.research
              ? [
                  `Research planning capacity for this response: ${JSON.stringify(effectiveInput.research)}`,
                  'Candidate tools remain subject to their adapter scope checks. Planning capacity does not establish exact-query approval; each external search obtains separate consent after planning.',
                  'Empty initial evidence does not mean a search returned no results. When the task permits research and supporting facts are missing, use type=request_evidence if canRequestEvidence is true instead of claiming a search failed or returning an unsupported answer.',
                  'When canRequestEvidence is false, do not request another search. Preserve any task-defined uncertainty or clarification; never invent supporting evidence.',
                ]
              : []),
          ].join('\n'),
        },
        ...messages,
      ],
      ...requestControls(provider, budget, 0.2),
    };
    const completedRequest = provider.capabilities.structuredOutput
      ? {
          ...request,
          responseFormat: {
            name: 'task_response',
            schema: taskResponseSchema(contract, effectiveInput),
          },
        }
      : request;
    return { status: 'ready', request: completedRequest };
  } catch {
    return { status: 'invalid' };
  }
}

/** Reserve a planner and a revised responder; candidate scope never substitutes for adapter consent. */
export function responderResearchAvailability(
  execution: MultiAgentExecutionIdentity,
  tools: readonly EvidenceSearchTool[],
  state: WorkflowState,
  revised = false,
): NonNullable<TaskResponderInput['research']> {
  const allowedScope = execution.allowedScope;
  const candidateTools = tools
    .filter(
      (tool) =>
        isSourceAllowed(allowedScope, tool.sourceKind) &&
        allowedScope.sourceIds?.length !== 0 &&
        (tool.id !== EUROPE_PMC_TOOL_ID ||
          (allowedScope.timeRange === undefined &&
            isSourceAllowed(allowedScope, 'external_medical', EUROPE_PMC_SOURCE_ID))),
    )
    .map(({ id, sourceKind, execution: toolExecution }) => ({
      id,
      sourceKind,
      execution: toolExecution,
    }));
  const remainingModelCalls = Math.max(0, state.budget.maxModelCalls - state.modelCalls);
  const remainingToolCalls = Math.max(0, state.budget.maxToolCalls - state.toolCalls);
  const remainingResearchCycles = revised
    ? 0
    : Math.max(0, state.budget.maxResearchCycles - state.researchCycles);
  return {
    canRequestEvidence:
      candidateTools.length > 0 &&
      remainingModelCalls >= 2 &&
      remainingToolCalls > 0 &&
      remainingResearchCycles > 0 &&
      state.evidenceReferences.length < state.budget.maxEvidenceItems,
    allowedScope,
    candidateTools,
    remainingModelCalls,
    remainingToolCalls,
    remainingResearchCycles,
  };
}

export function buildResearchRequest(
  provider: LanguageModelProvider,
  request: string,
  need: EvidenceNeed,
  allowedScope: AllowedEvidenceScope,
  tools: readonly EvidenceSearchTool[],
  budget: MultiAgentBudget,
): LanguageModelRequest {
  const body = researcherPrompt(request, need, tools, allowedScope, budget);
  // Source-specific search language must not affect local records or an unavailable tool.
  const canSearchEuropePmc =
    allowedScope.timeRange === undefined &&
    isSourceAllowed(allowedScope, 'external_medical', EUROPE_PMC_SOURCE_ID) &&
    tools.some((tool) => tool.id === EUROPE_PMC_TOOL_ID && tool.sourceKind === 'external_medical');
  const result: LanguageModelRequest = {
    messages: [
      {
        role: 'system',
        content:
          'You are the EvidenceResearcher. Select one allowlisted read-only search request. ' +
          'Do not answer the task or expand the allowed source and time scope.' +
          (canSearchEuropePmc ? ` ${EUROPE_PMC_QUERY_GUIDANCE}` : ''),
      },
      { role: 'user', content: body },
    ],
    ...requestControls(provider, budget, 0),
  };
  return provider.capabilities.structuredOutput
    ? {
        ...result,
        responseFormat: {
          name: 'evidence_research_plan',
          schema: researcherSchema(tools),
        },
      }
    : result;
}

// Some account-backed endpoints reject sampling controls entirely rather than ignoring them.
function requestControls(
  provider: LanguageModelProvider,
  budget: MultiAgentBudget,
  temperature: number,
) {
  const supported = provider.capabilities.requestControls ?? [];
  return {
    ...(supported.includes('maxOutputTokens') ? { maxOutputTokens: budget.maxOutputTokens } : {}),
    ...(supported.includes('temperature') ? { temperature } : {}),
  };
}
