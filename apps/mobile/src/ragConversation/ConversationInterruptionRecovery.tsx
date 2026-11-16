import { ConversationRestartAction } from './ConversationRestartAction';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppButton } from '../layout/AppButton';
import { AppText } from '../layout/AppText';
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
  const [checked, setChecked] = useState<'unavailable' | 'failed'>();
  const responseId = session.messages.at(-1)?.id;
  useEffect(() => {
    setChecked(undefined);
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
      {(resumable || checked) && (
        <AppText accessibilityRole="alert">
          {t(
            resumable
              ? 'conversationInterruption.pausedNotice'
              : checked
                ? checked === 'failed'
                  ? 'conversationInterruption.checkFailed'
                  : 'conversationInterruption.resumeUnavailable'
                : 'conversationInterruption.checkNotice',
          )}
        </AppText>
      )}
      <View style={styles.actions}>
        {resumable ? (
          <AppButton
            title={t('conversationInterruption.resumeAction')}
            variant="text"
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
            variant="text"
            size="compact"
            style={styles.action}
            onPress={async () => {
              if (owner.current) return;
              const controller = new AbortController();
              owner.current = controller;
              setChecking(true);
              // Protected checkpoint reads may stall; stop waiting without replaying any work.
              let releaseWait = () => {};
              const deadline = new Promise<void>(resolve => {
                releaseWait = resolve;
              });
              const timeout = setTimeout(() => {
                if (owner.current !== controller) return;
                controller.abort();
                owner.current = null;
                setChecking(false);
                setChecked('failed');
              }, 5000);
              controller.signal.addEventListener(
                'abort',
                () => {
                  clearTimeout(timeout);
                  releaseWait();
                },
                { once: true },
              );
              try {
                await Promise.race([
                  store.refreshRecovery?.(session.id, controller.signal),
                  deadline,
                ]);
                if (!controller.signal.aborted) setChecked('unavailable');
              } catch {
                /* Protected reads can fail while locked; this does not prove no checkpoint exists. */
                if (!controller.signal.aborted) setChecked('failed');
              } finally {
                clearTimeout(timeout);
                if (!controller.signal.aborted) {
                  setChecking(false);
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
    </View>
  );
}
const styles = StyleSheet.create({
  // Inline answer actions share the transcript gutter, not another full-width card.
  section: { marginHorizontal: 24, marginBottom: 8, gap: 4 },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  action: { alignSelf: 'flex-start', maxWidth: '100%' },
});
