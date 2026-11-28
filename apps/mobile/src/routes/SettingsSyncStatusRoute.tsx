import { settingsPageStyles } from '../layout/settingsPagePresentation';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { HealthKitAutoSyncFeature } from '../healthkit/autoSyncCheckpoint';
import type { HealthKitAutoSyncResult } from '../healthkit/autoSync';
import {
  loadLocalHealthKitAutoSyncSelection,
  loadLocalHealthKitAutoSyncStatus,
  syncLocalPreviouslyRequestedHealthKit,
} from '../healthkit/autoSyncLocal';
import { AppButton } from '../layout/AppButton';
import { AdaptiveColumns } from '../layout/AdaptiveColumns';
import { t } from '../i18n';
import { useNavigationEdgeVerticalScroll } from '../navigation/navigationEdgeScroll';
import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import { useNavigationLeaveStateRegistration } from '../navigation';
import { SettingsBackupSections } from './SettingsBackupRoute';
import type { BackupPreparationDisplayState } from '../backup/useBackupPreparation';
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
  retrySync = () => syncLocalPreviouslyRequestedHealthKit('manual'),
  calendarSync,
  backupState,
  onPrepareBackup,
}: {
  readonly loadSelection?: () => Promise<readonly HealthKitAutoSyncFeature[]>;
  readonly loadStatus?: () => Promise<AutoSyncSnapshot>;
  readonly retrySync?: () => Promise<HealthKitAutoSyncResult>;
  readonly calendarSync: CalendarAutoSyncActions;
  readonly backupState?: BackupPreparationDisplayState;
  readonly onPrepareBackup?: () => Promise<void>;
}) {
  const inset = useNavigationContentInset();
  // This page owns the scroll viewport; the panels retain their readable inset.
  const edge = useNavigationEdgeVerticalScroll({
    trailingPadding: inset.paddingRight,
  });
  const [selected, setSelected] = useState<readonly HealthKitAutoSyncFeature[]>(
    [],
  );
  const [snapshot, setSnapshot] = useState<AutoSyncSnapshot>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadRevision, setLoadRevision] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [retryOutcome, setRetryOutcome] = useState<
    HealthKitAutoSyncResult['status'] | null
  >(null);
  const [attemptedFeatures, setAttemptedFeatures] = useState<
    readonly HealthKitAutoSyncFeature[]
  >([]);
  const [retryReadbackFailed, setRetryReadbackFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setLoadFailed(false);
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
  }, [loadSelection, loadStatus, loadRevision]);

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
      {...edge.indicatorProps}
      contentContainerStyle={[styles.container, inset, edge.contentStyle]}
      style={[styles.scroll, edge.scrollViewStyle]}
      testID="settings-sync-status-scroll"
    >
      <AdaptiveColumns
        primary={
          <View style={styles.pageSections} testID="settings-sync-status-page">
            <SettingsSyncStatusHealthPanel
              attemptedFeatures={attemptedFeatures}
              calendarSync={calendarSync}
              loadFailed={loadFailed}
              message={message}
              retryReadbackFailed={retryReadbackFailed}
              selected={selected}
              snapshot={snapshot}
            />
            {loadFailed ? (
              <AppButton
                onPress={() => setLoadRevision(value => value + 1)}
                title={t('appointments.retry')}
                testID="health-data-status-retry"
                variant="secondary"
              />
            ) : null}
            <SettingsSyncStatusRecoveryPanel
              hasSelection={selected.length > 0}
              loaded={loaded}
              onRetry={() => {
                retry();
              }}
              retrying={retrying}
            />
            {backupState !== undefined && onPrepareBackup ? (
              <SettingsBackupSections
                state={backupState}
                onPrepare={onPrepareBackup}
              />
            ) : null}
          </View>
        }
        testID="settings-sync-status-layout"
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  pageSections: { ...settingsPageStyles.inset, gap: 16 },
  container: {
    flexGrow: 1,
  },
});
