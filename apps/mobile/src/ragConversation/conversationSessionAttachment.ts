import type {
  ConversationSession,
  ConversationSnapshot,
} from './conversationSessionTypes';
import type { createConversationSessionRetention } from './conversationSessionRetention';
import type { createConversationSessionRestoreState } from './conversationSessionRestoreState';
import { addConversation } from './conversationSessionTransitions';

/** Attach an existing durable identity before exposing its freshly restored transcript. */
export function createConversationSessionAttachment(input: {
  retention?: ReturnType<typeof createConversationSessionRetention>;
  restoration: ReturnType<typeof createConversationSessionRestoreState>;
  canRestore: boolean;
  empty: () => ConversationSession;
  snapshot: () => ConversationSnapshot;
  apply: (snapshot: ConversationSnapshot) => void;
  valid: () => boolean;
}) {
  return async (durableId: string, version: number, updatedAt: string) => {
    if (!input.retention || !input.canRestore || !input.valid())
      throw new Error('Conversation restoration is unavailable.');
    if (!Number.isFinite(Date.parse(updatedAt)))
      throw new Error('Conversation session date is invalid.');
    const session = input.empty();
    await input.retention.attachExisting(session.id, durableId, version);
    if (!input.valid())
      throw new Error('Conversation restoration was cancelled.');
    input.apply(
      addConversation(input.snapshot(), {
        ...session,
        createdAt: updatedAt,
        restoring: true,
      }),
    );
    // Listeners may clear or delete the session synchronously during publication.
    const stillAttached = () =>
      input.valid() &&
      input.retention!.activeIdentity(session.id) === durableId &&
      input
        .snapshot()
        .sessions.some(item => item.id === session.id && !item.quarantined);
    if (!stillAttached())
      throw new Error('Conversation restoration was cancelled.');
    await input.restoration.start(session.id, durableId);
    if (!stillAttached())
      throw new Error('Conversation restoration was cancelled.');
    return session.id;
  };
}
