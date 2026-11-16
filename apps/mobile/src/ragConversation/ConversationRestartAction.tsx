import { Alert, StyleSheet } from 'react-native';
import { AppButton } from '../layout/AppButton';
import { AppText } from '../layout/AppText';
import { t } from '../i18n';
import { conversationRecoveryDraft } from './conversationRecoveryDraft';
import type {
  ConversationSession,
  ConversationSessions,
} from './conversationSessionTypes';

/** A confirmed new request is distinct from checkpoint continuation and never reuses photo consent. */
export function ConversationRestartAction({
  store,
  session,
  onRestart,
}: {
  store: Pick<ConversationSessions, 'getSnapshot'>;
  session: ConversationSession;
  onRestart?: (question: string) => void;
}) {
  const recovery = conversationRecoveryDraft(session);
  if (!recovery || !onRestart) return null;
  if (recovery.attachment)
    return <AppText>{t('conversationInterruption.reattach')}</AppText>;
  return (
    <AppButton
      title={t('conversationInterruption.restartAction')}
      variant="text"
      size="compact"
      style={styles.action}
      onPress={() => {
        const response = session.messages.at(-1);
        Alert.alert(
          t('conversationInterruption.restartTitle'),
          t('conversationInterruption.restartWarning'),
          [
            {
              text: t('conversationInterruption.cancelRestart'),
              style: 'cancel',
            },
            {
              text: t('conversationInterruption.restartAction'),
              onPress: () => {
                const current = store
                  .getSnapshot()
                  .sessions.find(value => value.id === session.id);
                if (
                  !current ||
                  current.messages.at(-1) !== response ||
                  current.continueWorkflow
                )
                  return;
                const latest = conversationRecoveryDraft(current);
                if (latest && !latest.attachment) onRestart(latest.question);
              },
            },
          ],
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  action: { alignSelf: 'flex-start', maxWidth: '100%' },
});
