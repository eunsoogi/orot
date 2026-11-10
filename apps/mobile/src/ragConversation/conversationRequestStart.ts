import { getRagConversationCopy } from './copy';
import type {
  ConversationSession,
  PendingTurn,
} from './conversationSessionTypes';

/** Consumes a sendable draft and replaces only a failed prompt being retried. */
export function prepareConversationRequest(
  session: ConversationSession,
  nextId: () => number,
) {
  const question = session.draft.trim();
  if (
    !question ||
    session.busy ||
    session.restoring ||
    session.retryingSave ||
    (session.restoreAfterRetry && Boolean(session.unsavedCount)) ||
    session.restoreFailed ||
    session.quarantined
  )
    return null;

  const copy = getRagConversationCopy();
  const request: PendingTurn = {
    question,
    userMessageId: nextId(),
    saving: false,
    committed: false,
    summarySaving: false,
    summaryCommitted: false,
  };
  const responseId = nextId();
  const change: Partial<ConversationSession> = {
    draft: '',
    title: session.messages.length ? session.title : question.slice(0, 36),
    messages: [
      ...session.messages.filter(
        message =>
          !(
            message.failed &&
            message.role === 'user' &&
            message.content === question
          ),
      ),
      { id: request.userMessageId, role: 'user', content: question },
    ],
    busy: true,
    error: session.unsavedCount ? copy.unsavedAnswersRemain() : '',
    pendingMessage: { id: responseId, content: '', activity: copy.loading },
  };
  return { request, responseId, change, copy };
}
