import { getRagConversationCopy } from './copy';
import type {
  ConversationSession,
  PendingTurn,
} from './conversationSessionTypes';

/** Starts a composer turn or an explicit turn without exposing its prompt as a draft. */
export function prepareConversationRequest(
  session: ConversationSession,
  nextId: () => number,
  explicitQuestion?: string,
) {
  const restorePromptToComposer = explicitQuestion === undefined;
  const question = (explicitQuestion ?? session.draft).trim();
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
    restorePromptToComposer,
    saving: false,
    committed: false,
    summarySaving: false,
    summaryCommitted: false,
  };
  const responseId = nextId();
  const change: Partial<ConversationSession> = {
    ...(restorePromptToComposer ? { draft: '' } : {}),
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
