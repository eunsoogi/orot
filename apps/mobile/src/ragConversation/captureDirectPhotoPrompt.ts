import type { ConversationSessions } from './conversationSessionTypes';

/** Freeze the exact draft revision before review. Accepting a photo Send consumes only
 * that draft, and a failed delivery may restore it only in the untouched cleared slot. */
export function captureDirectPhotoPrompt(
  store: ConversationSessions,
  sessionId: number,
) {
  const read = () =>
    store.getSnapshot().sessions.find(row => row.id === sessionId);
  const original = read();
  const prompt = original?.draft ?? '';
  const same = () => {
    const row = read();
    return (
      !!original &&
      !!row &&
      row.draft === prompt &&
      row.draftEditRevision === original.draftEditRevision
    );
  };
  let accepted = false;
  let clearedRevision: number | undefined;
  return {
    prompt,
    current: () => accepted || same(),
    accept() {
      if (accepted || !same()) return false;
      accepted = true;
      if (prompt) {
        store.setDraft(sessionId, '');
        clearedRevision = (original!.draftEditRevision ?? 0) + 1;
      }
      return true;
    },
    restore() {
      const row = read();
      if (
        clearedRevision !== undefined &&
        row?.draft === '' &&
        row.draftEditRevision === clearedRevision
      )
        store.setDraft(sessionId, prompt);
      clearedRevision = undefined;
    },
  };
}
