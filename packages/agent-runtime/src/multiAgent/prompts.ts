import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import type { LanguageModelMessage } from '@orot/model-runtime';
import type {
  AllowedEvidenceScope,
  EvidenceNeed,
  EvidenceSearchTool,
  MultiAgentBudget,
} from './contracts';

const requestPromptTemplate = ChatPromptTemplate.fromMessages([
  ['system', '{systemPrompt}'],
  new MessagesPlaceholder('messages'),
]);

const researcherPromptTemplate = ChatPromptTemplate.fromMessages([
  [
    'human',
    [
      'Role: EvidenceResearcher. Choose one bounded, read-only evidence tool and its schema-limited input.',
      'Return JSON with toolId, sourceKind, and input. Do not answer the user task or invent fields.',
      'Search input must describe the missing task facts, not the protocol need label such as confirm_value.',
      'Need: {need}',
      'Task: {request}',
      'Allowed source scope: {allowedScope}',
      'Allowlisted tools: {tools}',
      'Maximum results: {maximumResults}',
    ].join('\n'),
  ],
]);

/** Format prompts directly so private prompt values never enter Runnable callbacks or tracing. */
export function formatPromptMessages(
  systemPrompt: string,
  messages: readonly BaseMessage[],
): Promise<BaseMessage[]> {
  // Values and message placeholders are opaque: JSON braces in medical text are not reparsed.
  return requestPromptTemplate.formatMessages({ systemPrompt, messages: [...messages] });
}

/** Add the formatted system message while preserving every native request message unchanged. */
export async function formatRequestMessages(
  systemPrompt: string,
  messages: readonly LanguageModelMessage[],
): Promise<LanguageModelMessage[]> {
  const placeholderMessages = messages.map(promptMessage);
  const formatted = await formatPromptMessages(systemPrompt, placeholderMessages);
  const [systemMessage, ...bodyMessages] = formatted;
  if (
    !SystemMessage.isInstance(systemMessage) ||
    typeof systemMessage.content !== 'string' ||
    bodyMessages.length !== placeholderMessages.length ||
    bodyMessages.some((message, index) => message !== placeholderMessages[index])
  ) {
    throw new Error('The chat prompt changed the request message order.');
  }
  return [{ role: 'system', content: systemMessage.content }, ...messages];
}

/** Preserve the existing researcher wording while treating task data as template values. */
export async function formatResearcherPrompt(
  request: string,
  need: EvidenceNeed,
  tools: readonly EvidenceSearchTool[],
  allowedScope: AllowedEvidenceScope,
  budget: MultiAgentBudget,
): Promise<string> {
  const [message] = await researcherPromptTemplate.formatMessages({
    need,
    request,
    allowedScope: JSON.stringify(allowedScope),
    tools: JSON.stringify(tools),
    maximumResults: budget.maxEvidenceItems,
  });
  if (!HumanMessage.isInstance(message) || typeof message.content !== 'string')
    throw new Error('The researcher prompt did not produce one text message.');
  return message.content;
}

function promptMessage(message: LanguageModelMessage): BaseMessage {
  if (message.role === 'system') return new SystemMessage({ content: message.content as never });
  if (message.role === 'user') return new HumanMessage({ content: message.content as never });
  if (message.role === 'assistant') {
    if (message.toolCalls?.length)
      throw new Error('Tool-call messages must remain existing LangChain messages.');
    return new AIMessage(message.content);
  }
  throw new Error('Tool result messages must remain existing LangChain messages.');
}
