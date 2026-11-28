import { Pressable, StyleSheet, View } from 'react-native';
import type { RecordingSourceRecord } from '../recording/recordingTypes';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
import { t } from '../i18n';
import { appColors } from '../layout/appColors';
import { formatRecordedAt } from '../recording/formatRecordedAt';
import { hubSpacing } from '../layout/hubSpacing';

interface RecentRecordsPanelProps {
  readonly recentRecording: RecordingSourceRecord | null;
  readonly recordingState: 'loading' | 'ready' | 'failed';
  readonly onRetryRecordings: () => void;
  readonly onOpenRecords: () => void;
}

/** Keeps recent-record loading, empty, failure and open behavior within Overview's ordered page. */
export function RecentRecordsPanel({
  recentRecording,
  recordingState,
  onRetryRecordings,
  onOpenRecords,
}: RecentRecordsPanelProps) {
  return (
    <View style={styles.section} testID="overview-recent-records-panel">
      <Text style={styles.recentHeading} testID="overview-open-records">
        {t('overview.recentRecord')}
      </Text>
      {recordingState === 'loading' ? (
        <Text testID="overview-recording-loading">
          {t('recording.library.loading')}
        </Text>
      ) : recordingState === 'failed' ? (
        <View style={styles.inlineState}>
          <Text accessibilityRole="alert">
            {t('recording.library.loadError')}
          </Text>
          <AppButton
            onPress={onRetryRecordings}
            testID="overview-recordings-retry"
            title={t('appointments.retry')}
          />
        </View>
      ) : recentRecording ? (
        <Pressable
          accessibilityRole="button"
          onPress={onOpenRecords}
          style={styles.recording}
          testID="overview-recent-recording"
        >
          <AppSymbol name="doc.text" color={appColors.text} />
          <View style={styles.recordingCopy}>
            <Text style={styles.recordingTitle}>{recentRecording.title}</Text>
            <Text style={styles.recordingDate}>
              {formatRecordedAt(recentRecording.recordedAt)}
            </Text>
          </View>
          <AppSymbol
            name="chevron.right"
            size={14}
            color={appColors.secondary}
          />
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={onOpenRecords}
          style={styles.recording}
          testID="overview-empty-recordings"
        >
          <Text style={styles.emptyText}>{t('overview.noRecentRecord')}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  recentHeading: { color: appColors.secondary, fontSize: 14 },
  recordingCopy: { flex: 1, gap: 4 },
  recordingTitle: { color: appColors.text, fontSize: 16, fontWeight: '500' },
  section: { gap: hubSpacing.item },
  recording: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 0,
    borderColor: appColors.border,
    backgroundColor: appColors.surface,
    borderRadius: 12,
    gap: 6,
    minHeight: 72,
    paddingHorizontal: 18,
  },
  recordingDate: { color: appColors.secondary, fontSize: 13 },
  emptyText: { color: appColors.secondary, fontSize: 15 },
  inlineState: { gap: 8 },
});
