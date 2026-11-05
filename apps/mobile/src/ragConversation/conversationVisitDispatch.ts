import type { ConversationEntryContext } from '../aiFeatures/integration/conversationIntent';
import type { RagConversationMessage } from './task';
import type { ConversationSessions } from './conversationSessions';
import type { ConversationScreenProps } from './ConversationScreenProps';
import { conversationEntryForSession } from './useConversationEntryIntent';

/** Entry intent starts one operation; later ordinary conversation turns do not regenerate questions. */
export function shouldPrepareVisitQuestions(
  context: ConversationEntryContext | undefined,
  history: readonly RagConversationMessage[],
): boolean {
  return context?.intent === 'visit-questions' && history.length === 0;
}

/** Resolve entry intent at send time so a different session cannot inherit it. */
export function sendConversationMessage(
  store: ConversationSessions,
  id: number,
  onSend: ConversationScreenProps['onSend'],
  prepare?: ConversationScreenProps['prepareVisitQuestions'],
) {
  return store.send(id, (question, history, signal, observer) => {
    const context = conversationEntryForSession(store, id);
    if (prepare && shouldPrepareVisitQuestions(context, history))
      return prepare(question, history, signal, observer, context);
    return context
      ? onSend(question, history, signal, observer, context)
      : onSend(question, history, signal, observer);
  });
}
