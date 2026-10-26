import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from '@langchain/core/prompts';

/** Keep the constructor regression on the real Metro/Hermes path alongside shipping workflows. */
export async function runLangChainMessageProbe() {
  const content = '{"synthetic":"{preserve braces}"}';
  const messages = [
    new SystemMessage(content),
    new HumanMessage(content),
    new AIMessage(content),
    new ToolMessage({ content, tool_call_id: 'synthetic-tool-call' }),
  ];
  const template = ChatPromptTemplate.fromMessages([
    ['system', '{instruction}'],
    new MessagesPlaceholder('messages'),
  ]);
  // Formatting directly follows the production privacy boundary without Runnable callbacks.
  const formatted = await template.formatMessages({
    instruction: content,
    messages,
  });
  return {
    types: formatted.map(message => message.type),
    contents: formatted.map(message => message.content),
    originalMessagesPreserved: messages.every(
      (message, index) => formatted[index + 1] === message,
    ),
    brandedInstances: [
      messages[0] instanceof SystemMessage,
      messages[1] instanceof HumanMessage,
      messages[2] instanceof AIMessage,
      messages[3] instanceof ToolMessage,
    ],
  };
}
