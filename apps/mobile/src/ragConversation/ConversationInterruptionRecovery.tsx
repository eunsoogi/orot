import { AppButton } from '../layout/AppButton';
import { AppText } from '../layout/AppText';
import { t } from '../i18n';
import type {
  ConversationSession,
  ConversationSessions,
} from './conversationSessionTypes';
import { conversationRecoveryDraft } from './conversationRecoveryDraft';

/** Only a live, safe LangGraph boundary gets a continue action. Uncertain work is never resubmitted. */
export function ConversationInterruptionRecovery({
  store,
  session,
}: {
  store: Pick<ConversationSessions, 'getSnapshot'>;
  session: ConversationSession;
}) {
  if (session.continueWorkflow)
    return (
      <>
        <AppText accessibilityRole="alert">
          {t('conversationInterruption.pausedNotice')}
        </AppText>
        <AppButton
          title={t('conversationInterruption.resumeAction')}
          onPress={() => {
            store
              .getSnapshot()
              .sessions.find(value => value.id === session.id)
              ?.continueWorkflow?.();
          }}
        />
      </>
    );
  if (
    session.messages.some(message => message.incomplete && message.coldResume)
  )
    return null;
  if (!conversationRecoveryDraft(session)) return null;
  return (
    <AppText accessibilityRole="alert">
      {t('conversationInterruption.resumeUnavailable')}
    </AppText>
  );
}
