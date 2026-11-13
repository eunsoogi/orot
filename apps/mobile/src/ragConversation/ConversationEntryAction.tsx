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

/** Keeps visit generation behind a session-bound tap while retaining suggestion behavior for other entries. */
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
          !canStartExplicitVisitPreparation(
            session,
            entry,
            prepareVisitQuestions,
          )
        }
        onPress={() => {
          startExplicitVisitPreparation(
            store,
            session.id,
            prepareVisitQuestions,
          )?.catch(() => {});
        }}
      />
    );
  return (
    <Button
      title={t('conversationIntent.useSuggestion', {
        question: session.entryPrompt,
      })}
      testID="conversation-intent-use-suggestion"
      disabled={Boolean(session.draft) || session.busy}
      variant="secondary"
      onPress={() => store.setDraft(session.id, session.entryPrompt!)}
    />
  );
}
