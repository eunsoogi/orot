import { StyleSheet, View } from 'react-native';
import type { HealthKitAutoSyncFeature } from '../healthkit/autoSyncCheckpoint';
import type { CalendarAutoSyncActions } from '../calendar/useCalendarAutoSync';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { formatDateTime, t } from '../i18n';
import { SettingsCalendarSyncSection } from './SettingsCalendarSyncSection';

type SavedSyncSnapshot = {
  readonly status: 'complete' | 'retryable';
  readonly updatedAt: string;
} | null;

/** Keeps saved HealthKit status, attempted categories, and calendar permission detail together. */
export function SettingsSyncStatusHealthPanel({
  selected,
  message,
  snapshot,
  attemptedFeatures,
  loadFailed,
  retryReadbackFailed,
  calendarSync,
  onOpenSystemSettings,
}: {
  readonly selected: readonly HealthKitAutoSyncFeature[];
  readonly message: string;
  readonly snapshot: SavedSyncSnapshot;
  readonly attemptedFeatures: readonly HealthKitAutoSyncFeature[];
  readonly loadFailed: boolean;
  readonly retryReadbackFailed: boolean;
  readonly calendarSync: CalendarAutoSyncActions;
  readonly onOpenSystemSettings: () => void;
}) {
  return (
    <View style={styles.panel} testID="settings-sync-status-primary">
      <Text
        accessibilityRole="header"
        style={styles.title}
        testID="settings-sync-status-title"
      >
        {t('settings.syncStatus.title')}
      </Text>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>
          {t('settings.syncStatus.healthData')}
        </Text>
        {selected.length > 0 ? (
          <Text style={styles.featureList} testID="settings-sync-selected-features">
            {selected
              .map(feature => t(`healthkit.unifiedImport.feature.${feature}`))
              .join(' · ')}
          </Text>
        ) : null}
        <Text
          accessibilityLiveRegion="polite"
          accessibilityRole={loadFailed ? 'alert' : undefined}
          style={styles.message}
          testID="settings-sync-status-message"
        >
          {message}
        </Text>
        {attemptedFeatures.length > 0 ? (
          <Text style={styles.featureList} testID="settings-sync-attempted-features">
            {t('settings.syncStatus.attemptedFeatures', {
              features: attemptedFeatures
                .map(feature => t(`healthkit.unifiedImport.feature.${feature}`))
                .join(' · '),
            })}
          </Text>
        ) : null}
        {snapshot && !retryReadbackFailed ? (
          <Text style={styles.timestamp} testID="settings-sync-status-updated-at">
            {t('settings.syncStatus.updatedAt', {
              timestamp: formatDateTime(new Date(snapshot.updatedAt)),
            })}
          </Text>
        ) : null}
        {retryReadbackFailed ? (
          <Text
            accessibilityRole="alert"
            style={styles.error}
            testID="settings-sync-status-readback-error"
          >
            {t('settings.syncStatus.readbackError')}
          </Text>
        ) : null}
      </View>
      <SettingsCalendarSyncSection
        sync={calendarSync}
        onOpenSystemSettings={onOpenSystemSettings}
      />
    </View>
  );
}

/** Groups controls so their full-height panel can move with native usable regions. */
export function SettingsSyncStatusRecoveryPanel({
  loaded,
  hasSelection,
  retrying,
  openSettingsError,
  onConfigureHealthData,
  onRetry,
  onOpenSystemSettings,
}: {
  readonly loaded: boolean;
  readonly hasSelection: boolean;
  readonly retrying: boolean;
  readonly openSettingsError: boolean;
  readonly onConfigureHealthData?: () => void;
  readonly onRetry: () => void;
  readonly onOpenSystemSettings: () => void;
}) {
  return (
    <View style={styles.panel} testID="settings-sync-status-secondary">
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>
          {t('settings.syncStatus.recovery')}
        </Text>
        {onConfigureHealthData ? (
          <AppButton
            onPress={onConfigureHealthData}
            testID="settings-sync-open-health-data"
            title={t('settings.healthData')}
            variant="secondary"
          />
        ) : null}
        <AppButton
          accessibilityState={{ busy: retrying }}
          disabled={!loaded || !hasSelection || retrying}
          onPress={onRetry}
          testID="settings-sync-retry"
          title={
            retrying
              ? t('settings.syncStatus.retrying')
              : t('settings.syncStatus.retry')
          }
        />
        <AppButton
          onPress={onOpenSystemSettings}
          testID="settings-sync-open-system-settings"
          title={t('settings.syncStatus.openSettings')}
          variant="secondary"
        />
        {openSettingsError ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {t('settings.syncStatus.openSettingsError')}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flexGrow: 1, gap: 16 },
  title: { color: appColors.text, fontSize: 30, fontWeight: '700' },
  card: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
    padding: 16,
  },
  sectionTitle: { color: appColors.text, fontSize: 17, fontWeight: '700' },
  featureList: { color: appColors.secondary, fontSize: 14, lineHeight: 20 },
  message: { color: appColors.text, fontSize: 14, lineHeight: 21 },
  timestamp: { color: appColors.secondary, fontSize: 13, lineHeight: 19 },
  error: { color: appColors.danger, fontSize: 14, lineHeight: 20 },
});
