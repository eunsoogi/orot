import { createConversationDurableIdentity } from './conversationDurableIdentity';
import type { ConversationSessionOptions } from './conversationSessionTypes';
import type { SavedHistoryDisplayRow } from './conversationSavedHistoryDisplay';

/** Capture the exact already-attached lease before dispatch. A late photo reply
 * cannot create a session, switch to a fresh lease, or enter canonical history. */
export function createConversationDirectPhotoRetention(
  options: ConversationSessionOptions,
  display: ((id: number, row: SavedHistoryDisplayRow) => void) | undefined,
  active: (id: number) => boolean,
) {
  return (sessionId: number) => {
    const lease = options.retention?.activeLease(sessionId);
    const write = options.writeDirectPhotoReply;
    if (
      !active(sessionId) ||
      !lease ||
      !write ||
      !display ||
      !options.readSavedHistoryDisplay
    )
      return null;
    const current = () => {
      const latest = options.retention?.activeLease(sessionId);
      return (
        active(sessionId) &&
        latest?.id === lease.id &&
        latest.version === lease.version
      );
    };
    const id = createConversationDurableIdentity().replace(
      'conversation:',
      'photo-reply:',
    );
    let consumed = false;
    return {
      current,
      async commit(text: string, admitted: () => boolean) {
        const ownsReply = () => current() && admitted();
        if (consumed || !ownsReply()) return false;
        consumed = true;
        const createdAt = new Date().toISOString();
        await write(
          lease.id,
          lease.version,
          { id, createdAt, text },
          ownsReply,
        );
        if (!ownsReply()) return false;
        display(sessionId, {
          kind: 'answer',
          id,
          createdAt,
          question: '',
          answer: text,
          directPhoto: true,
        });
        return true;
      },
    };
  };
}
