import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import type { RecordingSourceRecord } from '../recording/recordingTypes';
import { AppText as Text } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
import { t } from '../i18n';
import { appColors } from '../layout/appColors';
import { formatRecordedAt } from '../recording/formatRecordedAt';
import { hubSpacing } from '../layout/hubSpacing';

interface RecordsRecentSourcesProps {
  readonly recordings: readonly RecordingSourceRecord[];
  readonly recordingState: 'loading' | 'ready' | 'failed';
  readonly onRetry: () => void;
  readonly onOpenSavedRecordings: () => void;
}

/** Shows recent locally loaded audio sources; each row opens the existing library. */
export function RecordsRecentSources({
  recordings,
  recordingState,
  onRetry,
  onOpenSavedRecordings,
}: RecordsRecentSourcesProps) {
  return (
    <View style={styles.container} testID="records-recent-sources">
      <Text accessibilityRole="header" style={styles.heading}>
        {t('home.recentRecord')}
      </Text>
      {recordingState === 'loading' ? (
        <View style={styles.state} testID="records-recent-sources-loading">
          <ActivityIndicator
            accessibilityLabel={t('recording.library.loading')}
            color={appColors.secondary}
            size="small"
          />
          <Text>{t('recording.library.loading')}</Text>
        </View>
      ) : recordingState === 'failed' ? (
        <View style={styles.state}>
          <Text accessibilityRole="alert" testID="records-recent-sources-error">
            {t('recording.library.loadError')}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={onRetry}
            style={styles.retry}
            testID="records-recent-sources-retry"
          >
            <Text style={styles.retryTitle}>{t('appointments.retry')}</Text>
          </Pressable>
        </View>
      ) : recordings.length === 0 ? (
        <Text style={styles.empty} testID="records-recent-sources-empty">
          {t('recording.library.empty')}
        </Text>
      ) : (
        <View style={styles.rows}>
          {recordings.slice(0, 3).map(source => {
            const recordedAt = formatRecordedAt(source.recordedAt);
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={source.title + ', ' + recordedAt}
                key={source.id}
                onPress={onOpenSavedRecordings}
                style={styles.row}
                testID={'records-recent-source-' + source.id}
              >
                <AppSymbol
                  name="doc.text"
                  size={22}
                  color={appColors.primaryAction}
                />
                <View style={styles.copy}>
                  <Text style={styles.title}>{source.title}</Text>
                  <Text style={styles.date}>{recordedAt}</Text>
                </View>
                <AppSymbol
                  name="chevron.right"
                  size={16}
                  color={appColors.secondary}
                />
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: hubSpacing.item,
    minWidth: 0,
  },
  heading: { color: appColors.text, fontSize: 21, fontWeight: '700' },
  rows: { gap: hubSpacing.item },
  row: {
    alignItems: 'center',
    borderColor: appColors.border,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    minHeight: 72,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  copy: { flex: 1, gap: 3, minWidth: 0 },
  title: { color: appColors.text, fontSize: 16, fontWeight: '600' },
  date: { color: appColors.secondary, fontSize: 14, lineHeight: 20 },
  state: { alignItems: 'flex-start', gap: 12 },
  empty: { color: appColors.secondary, fontSize: 15, lineHeight: 22 },
  retry: {
    alignItems: 'center',
    backgroundColor: appColors.primarySoft,
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 16,
  },
  retryTitle: {
    color: appColors.primaryAction,
    fontSize: 15,
    fontWeight: '600',
  },
});
