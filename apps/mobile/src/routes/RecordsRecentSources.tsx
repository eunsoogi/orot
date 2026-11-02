import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import type { RecordingSourceRecord } from '../recording/recordingTypes';
import { AppText as Text } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
import { AppButton } from '../layout/AppButton';
import { t } from '../i18n';
import { appColors } from '../layout/appColors';
import {
  formatRecentTime,
  groupRecentRecordings,
} from './RecordsRecentTimeline';
import { hubSpacing } from '../layout/hubSpacing';

interface RecordsRecentSourcesProps {
  readonly recordings: readonly RecordingSourceRecord[];
  readonly recordingState: 'loading' | 'ready' | 'failed';
  readonly onRetry: () => void;
  readonly onOpenSavedRecordings: () => void;
}

/** Shows real recent recordings by local calendar day and keeps the full library reachable. */
export function RecordsRecentSources({
  recordings,
  recordingState,
  onRetry,
  onOpenSavedRecordings,
}: RecordsRecentSourcesProps) {
  const groups = groupRecentRecordings(recordings, new Date());

  return (
    <View style={styles.container} testID="records-recent-sources">
      <View style={styles.headingRow}>
        <Text accessibilityRole="header" style={styles.heading}>
          {t('home.recentRecord')}
        </Text>
        <AppButton
          accessibilityLabel={t('records.recent.viewAll')}
          onPress={onOpenSavedRecordings}
          size="compact"
          testID="records-recent-view-all"
          title={t('records.recent.viewAll') + '  ›'}
          variant="text"
        />
      </View>
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
        <View style={styles.groups}>
          {groups.map(group => (
            <View
              key={group.key}
              style={styles.group}
              testID={`records-recent-group-${group.key}`}
            >
              <View style={styles.groupHeadingRow}>
                <Text accessibilityRole="header" style={styles.groupHeading}>
                  {group.label}
                </Text>
                <View style={styles.groupDivider} />
              </View>
              <View style={styles.rows}>
                <View pointerEvents="none" style={styles.timelineLine} />
                {group.recordings.map(source => {
                  const time = formatRecentTime(source.recordedAt);
                  return (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${group.label}, ${source.title}, ${time}`}
                      key={source.id}
                      onPress={onOpenSavedRecordings}
                      style={styles.row}
                      testID={'records-recent-source-' + source.id}
                    >
                      <View style={styles.markerColumn}>
                        <View style={styles.marker} />
                      </View>
                      <View style={styles.icon}>
                        <AppSymbol
                          name="mic.fill"
                          color={appColors.primaryAction}
                        />
                      </View>
                      <Text style={styles.title}>{source.title}</Text>
                      <Text style={styles.time}>{time}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: hubSpacing.item, minWidth: 0 },
  headingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minWidth: 0,
  },
  heading: { color: appColors.text, fontSize: 21, fontWeight: '700' },
  groups: { gap: hubSpacing.item },
  group: { gap: 4, minWidth: 0 },
  groupHeadingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  groupHeading: { color: appColors.secondary, fontSize: 14, fontWeight: '600' },
  groupDivider: {
    backgroundColor: appColors.border,
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  rows: { gap: hubSpacing.item, minWidth: 0, position: 'relative' },
  timelineLine: {
    backgroundColor: appColors.border,
    bottom: 10,
    left: 5,
    position: 'absolute',
    top: 10,
    width: StyleSheet.hairlineWidth,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    minHeight: 58,
    minWidth: 0,
    paddingVertical: 7,
  },
  markerColumn: { alignItems: 'center', width: 12 },
  marker: {
    backgroundColor: appColors.primaryAction,
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  icon: {
    alignItems: 'center',
    backgroundColor: appColors.primarySoft,
    borderRadius: 12,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  title: { color: appColors.text, flex: 1, fontSize: 15, fontWeight: '600' },
  time: { color: appColors.secondary, fontSize: 14, textAlign: 'right' },
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
