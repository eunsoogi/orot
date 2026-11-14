import { AppButton } from '../layout/AppButton';
import { AppText } from '../layout/AppText';
import { t } from '../i18n';
import type {
  ConversationSession,
  ConversationSessions,
} from './conversationSessionTypes';
import { conversationRecoveryDraft } from './conversationRecoveryDraft';

/** This explicit review action never sends a prompt or repeats an already completed tool. */
export function ConversationInterruptionRecovery({
  store,
  session,
}: {
  store: Pick<ConversationSessions, 'getSnapshot' | 'setDraft'>;
  session: ConversationSession;
}) {
  const recovery = conversationRecoveryDraft(session);
  if (!recovery) return null;
  return (
    <>
      <AppText accessibilityRole="alert">
        {t('conversationInterruption.reviewNotice')}
      </AppText>
      {recovery.attachment ? (
        <AppText>{t('conversationInterruption.reviewAttachment')}</AppText>
      ) : null}
      {recovery.conflictingDraft ? (
        <AppText>{t('conversationInterruption.reviewDraftConflict')}</AppText>
      ) : null}
      <AppButton
        title={t('conversationInterruption.reviewAction')}
        disabled={recovery.attachment || recovery.conflictingDraft}
        onPress={() => {
          // Re-read on tap to fence a newer draft, request or removed session.
          const current = store
            .getSnapshot()
            .sessions.find(value => value.id === session.id);
          const latest = current && conversationRecoveryDraft(current);
          if (latest && !latest.attachment && !latest.conflictingDraft)
            store.setDraft(session.id, latest.question);
        }}
      />
    </>
  );
}
