import { conversationSessionErrorState } from './conversationSessionErrorState';
import { createConversationDurableIdentity } from './conversationDurableIdentity';
import type {
  ConversationSession,
  ConversationSessionOptions,
} from './conversationSessionTypes';

/** Preserve the attached lease and use ordinary live message IDs from submission to settlement.
 * The photo writer remains display-only storage: no pixels or photo turns enter model history. */
export function createConversationDirectPhotoRetention(
  options: ConversationSessionOptions,
  live: {
    find: (id: number) => ConversationSession | undefined;
    update: (id: number, change: Partial<ConversationSession>) => void;
    nextId: () => number;
  },
  active: (id: number) => boolean,
) {
  return (sessionId: number) => {
    const lease = options.retention?.activeLease(sessionId);
    const write = options.writeDirectPhotoReply;
    if (
      !active(sessionId) ||
      !lease ||
      !write ||
      !options.readSavedHistoryDisplay
    )
      return null;
    const current = () => {
      const latest = options.retention?.activeLease(sessionId);
      const session = live.find(sessionId);
      return Boolean(
        active(sessionId) &&
        session &&
        !session.quarantined &&
        !session.restoring &&
        !session.restoreFailed &&
        !session.leaseRefreshRequired &&
        latest?.id === lease.id &&
        latest.version === lease.version,
      );
    };
    const id = createConversationDurableIdentity().replace(
      'conversation:',
      'photo-reply:',
    );
    let pendingId: number | undefined;
    let replyId: number | undefined;
    let authoredCaption: string | undefined;
    let consumed = false;
    const ownsPending = () =>
      live
        .find(sessionId)
        ?.currentDisplayMessages?.some(
          message => message.id === pendingId && message.deliveryPending,
        ) === true;

    return {
      id,
      current,
      hasPending: ownsPending,
      start(prompt: string, draftRevision: number | undefined) {
        if (!current() || pendingId !== undefined) return false;
        const session = live.find(sessionId)!;
        if (
          session.draft !== prompt ||
          session.draftEditRevision !== draftRevision
        )
          return false;
        // Publish the pending row and consume precisely its own editor revision
        // in one session update. The next draft is never part of this delivery.
        authoredCaption = prompt;
        pendingId = live.nextId();
        replyId = live.nextId();
        live.update(sessionId, {
          ...(prompt
            ? conversationSessionErrorState.editDraft(session, '')
            : {}),
          currentDisplayMessages: [
            ...(session.currentDisplayMessages ?? []),
            {
              id: pendingId,
              role: 'user',
              content: prompt,
              delivery: { submittedAt: new Date().toISOString() },
              deliveryPending: true,
              directPhotoTurnId: id,
              photoAttached: true,
            },
          ],
        });
        return true;
      },
      cancel() {
        const session = live.find(sessionId);
        if (!session || !ownsPending()) return;
        live.update(sessionId, {
          currentDisplayMessages: session.currentDisplayMessages?.filter(
            message => message.id !== pendingId,
          ),
        });
      },
      async commit(text: string, admitted: () => boolean, keepCaption = false) {
        const ownsReply = () => current() && ownsPending() && admitted();
        if (consumed || !ownsReply()) return false;
        consumed = true;
        await write(
          lease.id,
          lease.version,
          {
            id,
            createdAt: new Date().toISOString(),
            text,
            ...(keepCaption && authoredCaption !== undefined
              ? { authoredCaption }
              : {}),
          },
          ownsReply,
        );
        if (!ownsReply()) return false;
        const session = live.find(sessionId)!;
        // Replace the status in place and append the answer in one store update.
        live.update(sessionId, {
          currentDisplayMessages: [
            ...(session.currentDisplayMessages ?? []).map(message =>
              message.id === pendingId
                ? { ...message, deliveryPending: undefined }
                : message,
            ),
            {
              id: replyId!,
              role: 'assistant',
              content: text,
              directPhotoTurnId: id,
              directPhotoReply: true,
            },
          ],
        });
        return true;
      },
    };
  };
}
