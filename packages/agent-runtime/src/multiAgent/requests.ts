import type { LanguageModelProvider, LanguageModelRequest } from '@orot/model-runtime';
import type {
  AllowedEvidenceScope,
  EvidenceSearchTool,
  EvidenceNeed,
  MultiAgentBudget,
  TaskResponderContract,
  TaskResponderInput,
} from './contracts';
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
): TaskRequestBuild {
  try {
    const messages = buildTaskMessages(contract, input);
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
      messages: [{ role: 'system', content: contract.systemPrompt }, ...messages],
      maxOutputTokens: budget.maxOutputTokens,
      temperature: 0.2,
    };
    const completedRequest = provider.capabilities.structuredOutput
      ? {
          ...request,
          responseFormat: { name: 'task_response', schema: taskResponseSchema(contract) },
        }
      : request;
    return { status: 'ready', request: completedRequest };
  } catch {
    return { status: 'invalid' };
  }
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
  const result: LanguageModelRequest = {
    messages: [
      {
        role: 'system',
        content:
          'You are the EvidenceResearcher. Select one allowlisted read-only search request. ' +
          'Do not answer the task or expand the allowed source and time scope.',
      },
      { role: 'user', content: body },
    ],
    maxOutputTokens: budget.maxOutputTokens,
    temperature: 0,
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
