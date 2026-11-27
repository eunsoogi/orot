import type { ConversationSession } from './conversationSessionTypes';

type Pending = NonNullable<ConversationSession['pendingMessage']>;
type Messages = ConversationSession['messages'];

/** Tool events usually belong only to the pending request. Preserve the immutable
 * settled transcript so other subscribers do not need to rebuild unchanged rows. */
export function conversationToolMetadataPublisher(
  input: {
    id: number;
    responseId: number;
    find(id: number): ConversationSession | undefined;
    update(id: number, change: Partial<ConversationSession>): void;
  },
  toolMessageId: string,
  metadata: (
    withholdHealthBody?: boolean,
  ) => Pick<Pending, 'toolEvents' | 'toolMessageId'>,
) {
  let checked: Messages | undefined;
  let matching: number[] = [];
  return () => {
    const session = input.find(input.id);
    if (!session) return undefined;
    const { messages, pendingMessage: pending } = session;
    if (checked !== messages) {
      checked = messages;
      matching = [];
      messages.forEach((message, index) => {
        if (message.toolMessageId === toolMessageId) matching.push(index);
      });
    }
    const ownedPending =
      pending?.id === input.responseId
        ? { ...pending, ...metadata(pending.withholdHealthBody) }
        : undefined;
    // A late cancellation can still update an exact already-settled partial row.
    let ownedMessages: Messages | undefined;
    if (matching.length) {
      const replacement = messages.slice();
      const details = metadata();
      for (const index of matching)
        replacement[index] = { ...messages[index]!, ...details };
      checked = ownedMessages = replacement;
    }
    if (ownedPending || ownedMessages)
      input.update(input.id, {
        ...(ownedPending ? { pendingMessage: ownedPending } : {}),
        ...(ownedMessages ? { messages: ownedMessages } : {}),
      });
    return pending;
  };
}
