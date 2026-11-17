import type { DisplayMessage } from './conversationDisplayMessage';

/** Keep native text inspection targets stable as presentation wrappers change. */
export function conversationMessageBodyTestID(message: DisplayMessage) {
  if (message.historyUnavailable) return 'rag-conversation-unavailable-body';
  if (message.streaming) return 'rag-conversation-stream';
  if (message.role === 'user') return undefined;
  return message.incomplete
    ? 'rag-conversation-incomplete-body'
    : 'rag-conversation-answer-body';
}
