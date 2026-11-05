import type { DisplayMessage } from './ConversationMessage';
import type { RagConversationMessage } from './task';

/** Provider history carries user text but never untracked assistant prose. */
export function providerHistoryMessage({
  role,
  content,
}: RagConversationMessage): RagConversationMessage {
  return {
    role,
    content:
      role === 'assistant'
        ? '이전 AI 답변은 현재 출처를 다시 확인하기 전에는 사용할 수 없어요.'
        : content,
  };
}

/** Assistant prose lacks complete input lineage; retrieve it explicitly after its sources are checked. */
export function conversationHistoryPayload(
  messages: readonly DisplayMessage[],
  retryQuestion: string,
): RagConversationMessage[] {
  return messages
    .filter(
      message =>
        !message.incomplete &&
        !(
          message.failed &&
          message.role === 'user' &&
          message.content === retryQuestion
        ),
    )
    .map(providerHistoryMessage);
}

/** Keep durable identities local so deleted turns cannot be reused from memory. */
export function retainedHistoryTurns(
  messages: readonly DisplayMessage[],
  retryQuestion: string,
) {
  const eligible = messages
    .filter(
      message =>
        !message.incomplete &&
        !(
          message.failed &&
          message.role === 'user' &&
          message.content === retryQuestion
        ),
    )
    .slice(-8);
  return eligible.flatMap((message, index) => {
    const answer = eligible[index + 1];
    return message.role === 'user' &&
      answer?.role === 'assistant' &&
      answer.retainedTurnId
      ? [{ question: message.content, id: answer.retainedTurnId }]
      : [];
  });
}
