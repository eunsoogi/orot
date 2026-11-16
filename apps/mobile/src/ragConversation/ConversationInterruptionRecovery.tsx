import { ConversationRestartAction } from './ConversationRestartAction';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppButton } from '../layout/AppButton';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import type {
  ConversationSession,
  ConversationSessions,
} from './conversationSessionTypes';
import { conversationRecoveryDraft } from './conversationRecoveryDraft';

/** Recovery inspects the same request; an unavailable checkpoint is never a resend. */
export function ConversationInterruptionRecovery({
  store,
  session,
  onRestart,
}: {
  store: Pick<ConversationSessions, 'getSnapshot'> &
    Partial<Pick<ConversationSessions, 'refreshRecovery'>>;
  session: ConversationSession;
  onRestart?: (question: string) => void;
}) {
  const owner = useRef<AbortController | null>(null);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const responseId = session.messages.at(-1)?.id;
  useEffect(() => {
    setChecked(false);
    setChecking(false);
    return () => {
      owner.current?.abort();
      owner.current = null;
    };
  }, [session.id, responseId]);
  const resumable = Boolean(session.continueWorkflow);
  if (
    !resumable &&
    (session.messages.some(
      message => message.incomplete && message.coldResume,
    ) ||
      !conversationRecoveryDraft(session))
  )
    return null;
  return (
    <View style={styles.section} testID="conversation-interruption-recovery">
      <AppText accessibilityRole="alert">
        {t(
          resumable
            ? 'conversationInterruption.pausedNotice'
            : checked
              ? 'conversationInterruption.resumeUnavailable'
              : 'conversationInterruption.checkNotice',
        )}
      </AppText>
      {resumable ? (
        <AppButton
          title={t('conversationInterruption.resumeAction')}
          variant="secondary"
          size="compact"
          style={styles.action}
          onPress={() =>
            store
              .getSnapshot()
              .sessions.find(value => value.id === session.id)
              ?.continueWorkflow?.()
          }
        />
      ) : store.refreshRecovery ? (
        <AppButton
          title={t(
            checking
              ? 'conversationInterruption.checking'
              : 'conversationInterruption.checkAction',
          )}
          disabled={checking}
          variant="secondary"
          size="compact"
          style={styles.action}
          onPress={async () => {
            if (owner.current) return;
            const controller = new AbortController();
            owner.current = controller;
            setChecking(true);
            try {
              await store.refreshRecovery?.(session.id, controller.signal);
            } catch {
              /* Protected reads can fail while locked; no request is dispatched. */
            } finally {
              if (!controller.signal.aborted) {
                setChecking(false);
                setChecked(true);
              }
              if (owner.current === controller) owner.current = null;
            }
          }}
        />
      ) : null}
      {!resumable && (
        <ConversationRestartAction
          store={store}
          session={session}
          onRestart={onRestart}
        />
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  section: {
    marginHorizontal: 24,
    marginVertical: 8,
    padding: 16,
    gap: 8,
    borderRadius: 16,
    backgroundColor: appColors.surface,
  },
  action: { alignSelf: 'flex-start', maxWidth: '100%' },
});
