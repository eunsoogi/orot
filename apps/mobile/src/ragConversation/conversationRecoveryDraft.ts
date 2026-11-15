import type { ConversationSession } from './conversationSessionTypes';

/** Identify an interrupted turn that needs honest recovery feedback, never a resend action. */
export function conversationRecoveryDraft(session: ConversationSession) {
  if (
    session.busy ||
    session.restoring ||
    session.restoreFailed ||
    session.quarantined
  )
    return null;
  const answer = session.messages.at(-1);
  const question = session.messages.at(-2);
  if (
    !answer?.incomplete ||
    !answer.interruptionReason ||
    answer.interruptionReason === 'user-stopped' ||
    answer.role !== 'assistant' ||
    question?.role !== 'user' ||
    !question.content.trim()
  )
    return null;
  // OCR alone is not a replacement for the previously consented photo submission.
  const attachment = Boolean(
    question.submittedInput?.ocr || question.photoAttached,
  );
  const conflictingDraft = Boolean(
    session.draft.trim() && session.draft !== question.content,
  );
  return { question: question.content, attachment, conflictingDraft };
}
