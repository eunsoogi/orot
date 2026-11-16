import { canSelectConversationChoice } from './selectConversationChoice';
import { AppButton as Button } from '../layout/AppButton';
import { t } from '../i18n';
import type { ConversationSession } from './conversationSessionTypes';
import type { ConversationSessions } from './conversationSessions';
import type { ConversationScreenProps } from './ConversationScreenProps';
import { conversationEntryForSession } from './useConversationEntryIntent';
import {
  canStartExplicitVisitPreparation,
  startExplicitVisitPreparation,
} from './conversationVisitDispatch';

/** Keeps contextual visit preparation in the same choice slot without exposing prompt-copy buttons. */
export function ConversationEntryAction({
  store,
  session,
  prepareVisitQuestions,
}: {
  readonly store: ConversationSessions;
  readonly session: ConversationSession;
  readonly prepareVisitQuestions: ConversationScreenProps['prepareVisitQuestions'];
}) {
  if (!session.entryPrompt) return null;
  const entry = conversationEntryForSession(store, session.id);
  if (entry?.intent === 'visit-questions')
    return (
      <Button
        title={t('visitQuestions.conversation.actions.prepare')}
        testID="conversation-visit-prepare"
        variant="secondary"
        disabled={
          !canSelectConversationChoice(store, session) ||
          !canStartExplicitVisitPreparation(
            session,
            entry,
            prepareVisitQuestions,
          )
        }
        onPress={() => {
          // A retained callback cannot dispatch after navigation or input changes.
          const current = store.getSnapshot();
          const active = current.sessions.find(item => item.id === session.id);
          if (
            current.activeId !== session.id ||
            !active ||
            !canSelectConversationChoice(store, active)
          )
            return;
          startExplicitVisitPreparation(
            store,
            session.id,
            prepareVisitQuestions,
          )?.catch(() => {});
        }}
      />
    );
  return null;
}
