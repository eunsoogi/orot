import { ActivityIndicator, StyleSheet } from 'react-native';
import { t } from '../i18n';

/** Native animation follows real restore state; it never delays or replaces retained content. */
export default function ConversationRestoreIndicator({
  restoringHistory,
  restoreFailed,
}: {
  readonly restoringHistory: boolean;
  readonly restoreFailed: boolean;
}) {
  if (!restoringHistory || restoreFailed) return null;
  return (
    <ActivityIndicator
      testID="conversation-history-restoring"
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('ragConversation.history.loading')}
      accessibilityState={{ busy: true }}
      style={styles.indicator}
      animating
    />
  );
}
const styles = StyleSheet.create({
  indicator: { alignSelf: 'center', marginVertical: 16 },
});
