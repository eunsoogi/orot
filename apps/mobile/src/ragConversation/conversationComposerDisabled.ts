import type { ConversationSession } from './conversationSessionTypes';

/** A restoring, quarantined, or unsaved recovery cannot accept another dispatch. */
export function conversationComposerDisabled(session: ConversationSession) {
  return Boolean(
    session.modelSelectionPending ||
    session.modelSelectionFailed ||
    session.restoring ||
    session.restoreFailed ||
    session.quarantined ||
    session.retryingSave ||
    (session.restoreAfterRetry && Boolean(session.unsavedCount)),
  );
}
