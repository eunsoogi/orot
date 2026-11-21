import { markConversationInput } from '../providers/conversationInputDiagnostic';
import type { ConversationScreenProps } from './ConversationScreenProps';
import type { ConversationSessions } from './conversationSessions';
import type { RetainedHealthActions } from './ConversationRetainedActions';
import { canSelectConversationChoice } from './selectConversationChoice';
import { conversationEntryForSession } from './useConversationEntryIntent';
import { entryIntentSender } from './entryIntentSender';
import { startExplicitVisitPreparation } from './conversationVisitDispatch';

/** A quick-choice tap is the submit gesture, not permission to bypass the existing sender's consent. */
export function immediateConversationChoices(
  store: ConversationSessions,
  id: number,
  actions: RetainedHealthActions | undefined,
  send: ConversationScreenProps['onSend'],
  prepare: ConversationScreenProps['prepareVisitQuestions'],
  isCurrent: (() => boolean) | undefined,
): RetainedHealthActions | undefined {
  if (!actions) return undefined;
  const wrap = (choose: (() => void) | undefined) =>
    choose &&
    (() => {
      const before = store.getSnapshot();
      const session = before.sessions.find(item => item.id === id);
      if (
        (isCurrent && !isCurrent()) ||
        before.activeId !== id ||
        !session ||
        !canSelectConversationChoice(store, session)
      )
        return;
      markConversationInput('conversation_quick_press');
      choose();
      const current = store.getSnapshot();
      const selected = current.sessions.find(item => item.id === id);
      if (
        current.activeId !== id ||
        (isCurrent && !isCurrent()) ||
        !selected?.entryPrompt ||
        !canSelectConversationChoice(store, selected)
      )
        return;
      if (
        conversationEntryForSession(store, id)?.intent === 'visit-questions'
      ) {
        startExplicitVisitPreparation(store, id, prepare, true)?.catch(
          () => {},
        );
      } else {
        store
          .sendQuickPrompt(
            id,
            selected.entryPrompt,
            entryIntentSender(store, id, send),
          )
          .catch(() => {});
      }
    });
  return {
    possibilities: wrap(actions.possibilities),
    visitQuestions: wrap(actions.visitQuestions),
    healthSummary: wrap(actions.healthSummary),
  };
}
