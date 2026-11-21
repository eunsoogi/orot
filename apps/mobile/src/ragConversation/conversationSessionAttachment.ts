import type {
  ConversationSession,
  ConversationSnapshot,
  ConversationSessionOptions,
} from './conversationSessionTypes';
import type { createConversationSessionRestoreState } from './conversationSessionRestoreState';
import {
  isProtectedConversationHistoryPage,
  type ConversationInitialPageAdmission,
} from './conversationHistoryPage';
import { addConversation } from './conversationSessionTransitions';

/** Attach an existing durable identity before exposing its freshly restored transcript. */
export function createConversationSessionAttachment(input: {
  options: ConversationSessionOptions;
  restoration: ReturnType<typeof createConversationSessionRestoreState>;
  empty: () => ConversationSession;
  snapshot: () => ConversationSnapshot;
  apply: (snapshot: ConversationSnapshot) => void;
  valid: () => boolean;
}) {
  const { retention, restoreSession, restoreSessionPage } = input.options;
  return async (
    durableId: string,
    version: number,
    updatedAt: string,
    select = true,
    isCurrent: () => boolean = () => true,
    signal?: AbortSignal,
    initialAdmission?: ConversationInitialPageAdmission,
  ) => {
    const valid = () => input.valid() && isCurrent() && !signal?.aborted;
    if (
      !retention ||
      !restoreSession ||
      !valid() ||
      (initialAdmission &&
        (!select || !isProtectedConversationHistoryPage(restoreSessionPage)))
    )
      throw new Error('Conversation restoration is unavailable.');
    if (!Number.isFinite(Date.parse(updatedAt)))
      throw new Error('Conversation session date is invalid.');
    const session = input.empty();
    await retention.attachExisting(session.id, durableId, version, valid);
    if (!valid() || retention.activeIdentity(session.id) !== durableId) {
      retention.discardUnpublished?.(session.id, durableId, version);
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
      retention.activeIdentity(session.id) === durableId &&
      input
        .snapshot()
        .sessions.some(item => item.id === session.id && !item.quarantined);
    if (!stillAttached())
      throw new Error('Conversation restoration was cancelled.');
    const admission = initialAdmission && {
      async wait(readSignal: AbortSignal) {
        const assertAdmitted = await initialAdmission.wait(readSignal);
        const assertCurrent = () => {
          assertAdmitted();
          const snapshot = input.snapshot();
          const sessionLease = retention.activeLease?.(session.id);
          const attached = snapshot.sessions.find(
            item => item.id === session.id,
          );
          // Route admission is not authority to publish into a replaced local
          // session or to assemble history using an older durable lease.
          if (
            !valid() ||
            snapshot.activeId !== session.id ||
            !attached ||
            attached.quarantined ||
            attached.leaseRefreshRequired ||
            sessionLease?.id !== durableId ||
            sessionLease.version !== version
          )
            throw new Error('Conversation restoration was cancelled.');
        };
        assertCurrent();
        return assertCurrent;
      },
    };
    await input.restoration.start(session.id, durableId, signal, admission);
    if (!stillAttached())
      throw new Error('Conversation restoration was cancelled.');
    return session.id;
  };
}
