import { StyleSheet, View } from 'react-native';
import { AppProgress } from '../layout/AppProgress';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import { hubSpacing } from '../layout/hubSpacing';

interface RecordsRecentSourceStateProps {
  readonly state: 'loading' | 'failed' | 'empty';
  readonly errorMessage?: string | null;
  readonly showDocumentLibraryEmpty?: boolean;
  readonly onRetry: () => void;
}

/** Keeps combined-feed status feedback consistent without changing any source records. */
export function RecordsRecentSourceState({
  state,
  errorMessage,
  showDocumentLibraryEmpty = false,
  onRetry,
}: RecordsRecentSourceStateProps) {
  if (state === 'loading') {
    return (
      <View style={styles.state} testID="records-recent-sources-loading">
        <AppProgress
          accessibilityElementsHidden
          color={appColors.secondary}
          size="small"
        />
        <Text accessibilityLiveRegion="polite">
          {t('records.recent.loading')}
        </Text>
      </View>
    );
  }

  if (state === 'failed') {
    return (
      <View style={styles.state}>
        <Text accessibilityRole="alert" testID="records-recent-sources-error">
          {errorMessage ?? t('records.recent.loadError')}
        </Text>
        <AppButton
          onPress={onRetry}
          testID="records-recent-sources-retry"
          title={t('appointments.retry')}
          variant="secondary"
          size="compact"
        />
      </View>
    );
  }

  return (
    <View
      testID={
        showDocumentLibraryEmpty
          ? 'medical-document-source-empty-list'
          : undefined
      }
    >
      <Text style={styles.empty} testID="records-recent-sources-empty">
        {t('records.recent.empty')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  state: { alignItems: 'flex-start', gap: hubSpacing.item },
  empty: { color: appColors.secondary, fontSize: 15, lineHeight: 22 },
});
