import { useEffect, useState } from 'react';
import { Linking, ScrollView, StyleSheet } from 'react-native';
import type { HealthKitAutoSyncFeature } from '../healthkit/autoSyncCheckpoint';
import type { HealthKitAutoSyncResult } from '../healthkit/autoSync';
import {
  loadLocalHealthKitAutoSyncSelection,
  loadLocalHealthKitAutoSyncStatus,
  syncLocalPreviouslyRequestedHealthKit,
} from '../healthkit/autoSyncLocal';
import { appColors } from '../layout/appColors';
import { AdaptiveColumns } from '../layout/AdaptiveColumns';
import { t } from '../i18n';
import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import { useNavigationLeaveStateRegistration } from '../navigation';
import type { CalendarAutoSyncActions } from '../calendar/useCalendarAutoSync';
import {
  SettingsSyncStatusHealthPanel,
  SettingsSyncStatusRecoveryPanel,
} from './SettingsSyncStatusPanels';

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
  const [retryOutcome, setRetryOutcome] = useState<
    HealthKitAutoSyncResult['status'] | null
  >(null);
  const [attemptedFeatures, setAttemptedFeatures] = useState<
    readonly HealthKitAutoSyncFeature[]
  >([]);
  const [retryReadbackFailed, setRetryReadbackFailed] = useState(false);

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
    setRetryOutcome(null);
    setAttemptedFeatures([]);
    setRetryReadbackFailed(false);
    try {
      const result = await retrySync();
      setRetryOutcome(result.status);
      setAttemptedFeatures(result.attemptedFeatures);
      try {
        setSnapshot(await loadStatus());
      } catch {
        // Keep the returned attempt result authoritative when its checkpoint cannot be reread.
        setRetryReadbackFailed(true);
      }
    } catch {
      setRetryOutcome('retryable');
    } finally {
      setRetrying(false);
    }
  }

  function openSystemSettings() {
    setOpenSettingsError(false);
    Linking.openSettings().catch(() => setOpenSettingsError(true));
  }

  const message = !loaded
    ? t(
        loadFailed
          ? 'settings.syncStatus.loadError'
          : 'settings.healthData.loading',
      )
    : selected.length === 0
      ? t('settings.syncStatus.noSelection')
      : retryOutcome
        ? t(`settings.syncStatus.${retryOutcome}`)
        : snapshot
          ? t(`settings.syncStatus.${snapshot.status}`)
          : t('settings.syncStatus.noResult');

  return (
    <ScrollView
      contentContainerStyle={[styles.container, inset]}
      style={styles.scroll}
      testID="settings-sync-status-scroll"
    >
      <AdaptiveColumns
        primary={
          <SettingsSyncStatusHealthPanel
            attemptedFeatures={attemptedFeatures}
            calendarSync={calendarSync}
            loadFailed={loadFailed}
            message={message}
            onOpenSystemSettings={openSystemSettings}
            retryReadbackFailed={retryReadbackFailed}
            selected={selected}
            snapshot={snapshot}
          />
        }
        secondary={
          <SettingsSyncStatusRecoveryPanel
            hasSelection={selected.length > 0}
            loaded={loaded}
            onConfigureHealthData={onConfigureHealthData}
            onOpenSystemSettings={openSystemSettings}
            onRetry={() => {
              retry();
            }}
            openSettingsError={openSettingsError}
            retrying={retrying}
          />
        }
        testID="settings-sync-status-layout"
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  container: {
    flexGrow: 1,
    backgroundColor: appColors.background,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 32,
  },
});
