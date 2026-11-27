import type { ConversationSession } from './conversationSessionTypes';

/** Interleave locally owned display-only rows using the same order and IDs as ordinary messages.
 * The result is for presentation/click targets only, never provider context. */
export function currentConversationMessages(
  session: ConversationSession,
  active = true,
) {
  const { messages, currentDisplayMessages } = session;
  if (
    !active ||
    !currentDisplayMessages?.length ||
    session.quarantined ||
    session.restoring ||
    session.restoreFailed ||
    session.leaseRefreshRequired ||
    session.modelSelectionFailed ||
    (session.modelSelectionPending && !session.modelSelectionKeepsDisplay)
  )
    return messages;
  const merged: (typeof messages)[number][] = [];
  let displayIndex = 0;
  for (const message of messages) {
    while (
      currentDisplayMessages[displayIndex] &&
      currentDisplayMessages[displayIndex]!.id < message.id
    ) {
      merged.push(currentDisplayMessages[displayIndex++]!);
    }
    merged.push(message);
  }
  return [...merged, ...currentDisplayMessages.slice(displayIndex)];
}
