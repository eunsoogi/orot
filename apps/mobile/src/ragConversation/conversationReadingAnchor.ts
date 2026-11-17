import type { DisplayMessage } from './conversationDisplayMessage';

/** A user row belongs to the following answer's durable turn, never its transient display id. */
export function conversationReadingKey(
  messages: readonly DisplayMessage[],
  index: number,
) {
  const row = messages[index];
  const answer = row?.role === 'user' ? messages[index + 1] : row;
  const turnId = answer?.toolMessageId ?? answer?.retainedTurnId;
  return row && answer?.role === 'assistant' && turnId
    ? { turnId, role: row.role }
    : undefined;
}
