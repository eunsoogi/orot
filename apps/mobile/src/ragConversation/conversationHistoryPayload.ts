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
