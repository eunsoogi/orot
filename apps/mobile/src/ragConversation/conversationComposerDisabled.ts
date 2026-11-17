import type { ConversationSession } from './conversationSessionTypes';

/** A restoring, quarantined, or unsaved recovery cannot accept another dispatch. */
export function conversationComposerDisabled(
  session: ConversationSession,
  retryPreflight = false,
) {
  return Boolean(
    session.modelSelectionPending ||
    (session.modelSelectionFailed && !retryPreflight) ||
    session.restoring ||
    (session.restoreFailed && !retryPreflight) ||
    session.quarantined ||
    session.retryingSave ||
    (session.restoreAfterRetry && Boolean(session.unsavedCount)),
  );
}
