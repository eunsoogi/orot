import { useEffect, useState } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import type { HealthKitAutoSyncFeature } from '../healthkit/autoSyncCheckpoint';
import type { HealthKitAutoSyncResult } from '../healthkit/autoSync';
import {
  loadLocalHealthKitAutoSyncSelection,
  loadLocalHealthKitAutoSyncStatus,
  syncLocalPreviouslyRequestedHealthKit,
} from '../healthkit/autoSyncLocal';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { formatDateTime, t } from '../i18n';
import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import { useNavigationLeaveStateRegistration } from '../navigation';
import { SettingsCalendarSyncSection } from './SettingsCalendarSyncSection';
import type { CalendarAutoSyncActions } from '../calendar/useCalendarAutoSync';

type AutoSyncSnapshot = Awaited<
  ReturnType<typeof loadLocalHealthKitAutoSyncStatus>
>;

/** Shows aggregate sync recovery state without exposing HealthKit records or grant state. */
export function SettingsSyncStatusRoute({
  loadSelection = loadLocalHealthKitAutoSyncSelection,
  loadStatus = loadLocalHealthKitAutoSyncStatus,
  retrySync = syncLocalPreviouslyRequestedHealthKit,
  calendarSync,
  onConfigureHealthData,
}: {
  readonly loadSelection?: () => Promise<readonly HealthKitAutoSyncFeature[]>;
  readonly loadStatus?: () => Promise<AutoSyncSnapshot>;
  readonly retrySync?: () => Promise<HealthKitAutoSyncResult>;
  readonly calendarSync: CalendarAutoSyncActions;
  readonly onConfigureHealthData?: () => void;
}) {
  const inset = useNavigationContentInset();
  const [selected, setSelected] = useState<readonly HealthKitAutoSyncFeature[]>(
    [],
  );
  const [snapshot, setSnapshot] = useState<AutoSyncSnapshot>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [openSettingsError, setOpenSettingsError] = useState(false);
  const [retryStatus, setRetryStatus] = useState<
    'complete' | 'retryable' | null
  >(null);

  useEffect(() => {
    let active = true;
    Promise.all([loadSelection(), loadStatus()])
      .then(([features, status]) => {
        if (!active) return;
        setSelected(features);
        setSnapshot(status);
        setLoaded(true);
      })
      .catch(() => active && setLoadFailed(true));
    return () => {
      active = false;
    };
  }, [loadSelection, loadStatus]);

  useNavigationLeaveStateRegistration({
    canLeave: !retrying,
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: retrying,
    revision: retrying ? 1 : 0,
    inputRevision: retrying ? 1 : 0,
  });

  async function retry() {
    if (retrying || selected.length === 0) return;
    setRetrying(true);
    setRetryStatus(null);
    try {
      const result = await retrySync();
      setRetryStatus(result.status === 'complete' ? 'complete' : 'retryable');
      setSnapshot(await loadStatus());
    } catch {
      setRetryStatus('retryable');
    } finally {
      setRetrying(false);
    }
  }

  function openSystemSettings() {
    setOpenSettingsError(false);
    void Linking.openSettings().catch(() => setOpenSettingsError(true));
  }

  const message =
    selected.length === 0
      ? t('settings.syncStatus.noSelection')
      : retryStatus
        ? t(`settings.syncStatus.${retryStatus}`)
        : snapshot
          ? t(`settings.syncStatus.${snapshot.status}`)
          : t('settings.syncStatus.noResult');

  return (
    <ScrollView
      contentContainerStyle={[styles.container, inset]}
      style={styles.scroll}
      testID="settings-sync-status-scroll"
    >
      <Text
        accessibilityRole="header"
        style={styles.title}
        testID="settings-sync-status-title"
      >
        {t('settings.syncStatus.title')}
      </Text>
      {loadFailed ? (
        <Text
          accessibilityRole="alert"
          style={styles.error}
          testID="settings-sync-status-load-error"
        >
          {t('settings.syncStatus.loadError')}
        </Text>
      ) : null}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>
          {t('settings.syncStatus.healthData')}
        </Text>
        {selected.length > 0 ? (
          <Text
            style={styles.featureList}
            testID="settings-sync-selected-features"
          >
            {selected
              .map(feature => t(`healthkit.unifiedImport.feature.${feature}`))
              .join(' · ')}
          </Text>
        ) : null}
        <Text
          accessibilityLiveRegion="polite"
          style={styles.message}
          testID="settings-sync-status-message"
        >
          {!loaded && !loadFailed ? t('settings.healthData.loading') : message}
        </Text>
        {snapshot ? (
          <Text
            style={styles.timestamp}
            testID="settings-sync-status-updated-at"
          >
            {t('settings.syncStatus.updatedAt', {
              timestamp: formatDateTime(new Date(snapshot.updatedAt)),
            })}
          </Text>
        ) : null}
      </View>
      <SettingsCalendarSyncSection
        sync={calendarSync}
        onOpenSystemSettings={openSystemSettings}
      />
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
        disabled={!loaded || selected.length === 0 || retrying}
        onPress={() => void retry()}
        testID="settings-sync-retry"
        title={
          retrying
            ? t('settings.syncStatus.retrying')
            : t('settings.syncStatus.retry')
        }
      />
      <AppButton
        onPress={openSystemSettings}
        testID="settings-sync-open-system-settings"
        title={t('settings.syncStatus.openSettings')}
        variant="secondary"
      />
      {openSettingsError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {t('settings.syncStatus.openSettingsError')}
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  container: {
    flexGrow: 1,
    backgroundColor: appColors.background,
    gap: 16,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 32,
  },
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
