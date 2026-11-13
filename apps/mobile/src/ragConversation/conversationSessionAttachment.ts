import type {
  ConversationSession,
  ConversationSnapshot,
  ConversationSessionOptions,
} from './conversationSessionTypes';
import type { createConversationSessionRestoreState } from './conversationSessionRestoreState';
import { addConversation } from './conversationSessionTransitions';

/** Attach an existing durable identity before exposing its freshly restored transcript. */
export function createConversationSessionAttachment(input: {
  retention?: ConversationSessionOptions['retention'];
  restoration: ReturnType<typeof createConversationSessionRestoreState>;
  canRestore: boolean;
  empty: () => ConversationSession;
  snapshot: () => ConversationSnapshot;
  apply: (snapshot: ConversationSnapshot) => void;
  valid: () => boolean;
}) {
  return async (
    durableId: string,
    version: number,
    updatedAt: string,
    select = true,
    isCurrent: () => boolean = () => true,
    signal?: AbortSignal,
  ) => {
    const valid = () => input.valid() && isCurrent() && !signal?.aborted;
    if (!input.retention || !input.canRestore || !valid())
      throw new Error('Conversation restoration is unavailable.');
    if (!Number.isFinite(Date.parse(updatedAt)))
      throw new Error('Conversation session date is invalid.');
    const session = input.empty();
    await input.retention.attachExisting(session.id, durableId, version, valid);
    if (!valid() || input.retention.activeIdentity(session.id) !== durableId) {
      input.retention.discardUnpublished?.(session.id, durableId, version);
      throw new Error('Conversation restoration was cancelled.');
    }
    const previous = input.snapshot();
    const next = addConversation(previous, {
      ...session,
      createdAt: updatedAt,
      restoring: true,
    });
    input.apply(select ? next : { ...next, activeId: previous.activeId });
    // Listeners may clear or delete the session synchronously during publication.
    const stillAttached = () =>
      valid() &&
      input.retention!.activeIdentity(session.id) === durableId &&
      input
        .snapshot()
        .sessions.some(item => item.id === session.id && !item.quarantined);
    if (!stillAttached())
      throw new Error('Conversation restoration was cancelled.');
    await input.restoration.start(session.id, durableId, signal);
    if (!stillAttached())
      throw new Error('Conversation restoration was cancelled.');
    return session.id;
  };
}
