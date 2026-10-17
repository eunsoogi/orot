import { Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
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
  readonly onOpenHealthLibrary: () => void;
}

/** Keeps recording and local records discoverable without manual HealthKit entry points. */
export function RecordsRoute({
  refreshKey,
  recordingState,
  onRetry,
  onOpenRecording,
  onOpenHealthLibrary,
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
      <Text style={styles.subtitle}>{t('records.subtitle')}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={onOpenRecording}
        style={styles.recordingAction}
        testID="records-new-recording"
      >
        <View style={styles.recordingIcon}>
          <AppSymbol
            name="mic.fill"
            size={30}
            color={appColors.primaryAction}
          />
        </View>
        <Text style={styles.recordingActionTitle}>
          {t('records.newRecording')}
        </Text>
      </Pressable>

      <RecordingLibraryPanel
        refreshKey={refreshKey}
        service={recordingLibraryService}
      />
      {recordingState === 'failed' ? (
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={styles.retry}
          testID="records-retry"
        >
          <Text style={styles.retryTitle}>{t('appointments.retry')}</Text>
        </Pressable>
      ) : null}

      <Pressable
        accessibilityRole="button"
        onPress={onOpenHealthLibrary}
        style={styles.healthCard}
        testID="records-open-health-library"
      >
        <View style={styles.healthIcon}>
          <AppSymbol
            name="folder.fill"
            size={28}
            color={appColors.primaryText}
          />
        </View>
        <View style={styles.cardCopy}>
          <Text style={styles.cardTitle}>{t('records.healthRecords')}</Text>
          <Text style={styles.cardSummary}>
            {t('healthRecords.description')}
          </Text>
        </View>
        <Text style={styles.chevron} accessibilityElementsHidden>
          ›
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: appColors.background,
    gap: 16,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 24,
  },
  title: { color: appColors.text, fontSize: 40, fontWeight: '700' },
  subtitle: { color: appColors.secondary, fontSize: 16, lineHeight: 22 },
  recordingAction: {
    alignItems: 'center',
    backgroundColor: appColors.primaryAction,
    borderRadius: 22,
    justifyContent: 'center',
    gap: 12,
    minHeight: 176,
    marginTop: 4,
  },
  recordingIcon: {
    alignItems: 'center',
    backgroundColor: appColors.surface,
    borderRadius: 28,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  recordingActionTitle: {
    color: appColors.onPrimary,
    fontSize: 21,
    fontWeight: '700',
  },
  healthCard: {
    alignItems: 'center',
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 16,
    minHeight: 124,
    paddingHorizontal: 18,
  },
  healthIcon: {
    alignItems: 'center',
    backgroundColor: appColors.primarySoft,
    borderRadius: 18,
    height: 64,
    justifyContent: 'center',
    width: 64,
  },
  cardCopy: { flex: 1, gap: 4 },
  cardTitle: { color: appColors.text, fontSize: 17, fontWeight: '700' },
  cardSummary: { color: appColors.secondary, fontSize: 14, lineHeight: 20 },
  chevron: { color: appColors.secondary, fontSize: 24 },
  retry: {
    alignItems: 'center',
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    minHeight: 48,
  },
  retryTitle: { color: appColors.primaryText, fontSize: 15, fontWeight: '600' },
});
