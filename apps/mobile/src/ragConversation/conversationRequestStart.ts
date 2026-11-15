import { getRagConversationCopy } from './copy';
import { t } from '../i18n';
import { conversationRequestReceipt } from './initialResponse';
import type {
  ConversationSession,
  PendingTurn,
} from './conversationSessionTypes';

/** Starts a composer turn or an explicit turn without exposing its prompt as a draft. */
export function prepareConversationRequest(
  session: ConversationSession,
  nextId: () => number,
  explicitQuestion?: string,
  hasPhoto = false,
) {
  const restorePromptToComposer = explicitQuestion === undefined;
  const question = (explicitQuestion ?? session.draft).trim();
  if (
    (!question && !hasPhoto) ||
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
    title: session.messages.length
      ? session.title
      : (question || t('ragConversation.photo.message')).slice(0, 36),
    messages: [
      ...session.messages.filter(
        message =>
          !(
            message.failed &&
            message.role === 'user' &&
            message.content === question
          ),
      ),
      {
        id: request.userMessageId,
        role: 'user',
        content: question,
        ...(hasPhoto ? { photoAttached: true } : {}),
      },
    ],
    busy: true,
    error: session.unsavedCount ? copy.unsavedAnswersRemain() : '',
    // A local receipt covers retrieval and provider latency without another model call.
    // It is ephemeral, not an answer, a tool-progress claim, or a retained health fact.
    pendingMessage: {
      id: responseId,
      content: '',
      activity: copy.loading,
      initialResponse: {
        callId: `received:${responseId}`,
        source: 'receipt',
        text: conversationRequestReceipt,
      },
    },
  };
  return { request, responseId, change, copy };
}
