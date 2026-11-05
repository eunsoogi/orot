import type { ConversationSessions } from './conversationSessions';
import type { ConversationScreenProps } from './ConversationScreenProps';
import type { DisplayMessage } from './ConversationMessage';

/** Start a separate turn without replacing a composer draft or an existing review. */
export function regenerateVisitQuestions(input: {
  store: ConversationSessions;
  sessionId: number;
  message: DisplayMessage;
  prepare?: ConversationScreenProps['prepareVisitQuestions'];
}) {
  const { store, sessionId, message, prepare } = input;
  const current = store
    .getSnapshot()
    .sessions.find(item => item.id === sessionId);
  const index =
    current?.messages.findIndex(item => item.id === message.id) ?? -1;
  const question = current?.messages
    .slice(0, index)
    .reverse()
    .find(item => item.role === 'user')?.content;
  if (
    !prepare ||
    !current ||
    current.busy ||
    current.draft ||
    !question ||
    !message.visitQuestions
  ) {
    store.setError(
      sessionId,
      '작성 중인 메시지를 보내거나 지운 뒤 질문을 다시 만들어 주세요.',
    );
    return;
  }
  store.setDraft(sessionId, question);
  store
    .send(sessionId, (text, history, signal, observer) =>
      prepare(text, history, signal, observer, {
        intent: 'visit-questions',
        entryKey: message.visitQuestions!.review.ownerKey,
        appointmentId: message.visitQuestions!.appointment.id,
      }),
    )
    .catch(() => {});
}
