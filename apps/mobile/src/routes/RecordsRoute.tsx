import { Pressable, StyleSheet, View } from 'react-native';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import { appColors } from '../layout/appColors';
import RecordingLibraryPanel from '../recording/RecordingLibraryPanel';
import { recordingLibraryService } from '../recording/recordingLibraryService';
import { useNavigationLeaveStateRegistration } from '../navigation';

interface RecordsRouteProps {
  readonly refreshKey: string;
  readonly recordingState: 'loading' | 'ready' | 'failed';
  readonly onRetry: () => void;
  readonly onOpenRecording: () => void;
  readonly onOpenHealthImport: () => void;
  readonly onOpenBloodPressure: () => void;
}

/** Groups the existing recording and HealthKit entry points under Records. */
export function RecordsRoute({
  refreshKey,
  recordingState,
  onRetry,
  onOpenRecording,
  onOpenHealthImport,
  onOpenBloodPressure,
}: RecordsRouteProps) {
  useNavigationLeaveStateRegistration({
    canLeave: true,
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: false,
    revision: 0,
    inputRevision: 0,
  });

  return (
    <View style={styles.container}>
      <Text
        accessibilityRole="header"
        style={styles.title}
        testID="records-title"
      >
        {t('records.title')}
      </Text>
      <View style={styles.actions}>
        <AppButton
          onPress={onOpenRecording}
          testID="records-new-recording"
          title={t('records.newRecording')}
        />
        <AppButton
          onPress={onOpenHealthImport}
          testID="records-health-import"
          title={t('records.import')}
          variant="secondary"
        />
      </View>

      <RecordingLibraryPanel
        refreshKey={refreshKey}
        service={recordingLibraryService}
      />
      {recordingState === 'failed' ? (
        <AppButton
          onPress={onRetry}
          testID="records-retry"
          title={t('appointments.retry')}
          variant="secondary"
        />
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('records.healthRecords')}</Text>
        <SettingsRow
          onPress={onOpenHealthImport}
          testID="records-open-common-observations"
          title={t('healthkit.commonObservations.open')}
        />
        <SettingsRow
          onPress={onOpenBloodPressure}
          testID="records-open-blood-pressure"
          title={t('healthkit.bloodPressure.open')}
        />
      </View>
    </View>
  );
}

function SettingsRow({
  onPress,
  testID,
  title,
}: {
  readonly onPress: () => void;
  readonly testID: string;
  readonly title: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={styles.row}
      testID={testID}
    >
      <Text style={styles.rowTitle}>{title}</Text>
      <Text style={styles.chevron} accessibilityElementsHidden>
        ›
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: appColors.background,
    gap: 26,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 24,
  },
  title: { color: appColors.text, fontSize: 40, fontWeight: '700' },
  actions: { gap: 10 },
  section: { gap: 10 },
  sectionTitle: { color: appColors.text, fontSize: 17, fontWeight: '700' },
  row: {
    alignItems: 'center',
    backgroundColor: appColors.surface,
    borderRadius: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 64,
    paddingHorizontal: 16,
  },
  rowTitle: { color: appColors.text, fontSize: 15, fontWeight: '600' },
  chevron: { color: appColors.secondary, fontSize: 24 },
});
