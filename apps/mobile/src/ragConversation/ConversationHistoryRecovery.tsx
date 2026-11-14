import { StyleSheet, View } from 'react-native';
import { AppButton } from '../layout/AppButton';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';

/** Keeps truthful recovery feedback in the history scroll without replacing retained rows. */
export function ConversationHistoryRecovery({
  deletionError,
  restoreFailed,
  onRetryRestore,
}: {
  readonly deletionError?: string;
  readonly restoreFailed: boolean;
  readonly onRetryRestore: () => void;
}) {
  if (!deletionError && !restoreFailed) return null;

  return (
    <View style={styles.section} testID="conversation-history-recovery">
      {deletionError ? (
        <AppText accessibilityRole="alert">{deletionError}</AppText>
      ) : null}
      {restoreFailed ? (
        <>
          <AppText accessibilityRole="alert">
            {t('ragConversation.history.restoreFailed')}
          </AppText>
          <AppButton
            title={t('ragConversation.history.retryRestore')}
            onPress={onRetryRestore}
            variant="secondary"
            size="compact"
            style={styles.action}
            testID="conversation-history-retry"
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginHorizontal: 24,
    marginVertical: 12,
    padding: 16,
    gap: 8,
    borderRadius: 16,
    backgroundColor: appColors.surface,
  },
  // Keep the recovery action subordinate to the page title while allowing large text to wrap.
  action: { alignSelf: 'flex-start', maxWidth: '100%' },
});
