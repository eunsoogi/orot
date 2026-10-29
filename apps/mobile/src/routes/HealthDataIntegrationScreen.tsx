import { ScrollView, StyleSheet, View } from 'react-native';
import type { HealthKitAutoSyncFeature } from '../healthkit/autoSyncCheckpoint';
import type { HealthKitAutoSyncConfigurationResult } from '../healthkit/autoSyncSettings';
import { formatDateTime, t } from '../i18n';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { AdaptiveColumns } from '../layout/AdaptiveColumns';
import { appColors } from '../layout/appColors';
import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import { HealthDataFeatureSelection } from './HealthDataFeatureSelection';
import type { HealthDataIntegrationStatus } from './HealthDataIntegrationStatus';

/** Keeps choices, permission context and final actions in one region-bound scrolling page. */
export function HealthDataIntegrationScreen({
  integrationStatus,
  loadFailed,
  loaded,
  notice,
  onRetryLoad,
  onRetryStatus,
  onSave,
  onToggle,
  saving,
  selected,
  statusLoadFailed,
}: {
  readonly integrationStatus: HealthDataIntegrationStatus | null;
  readonly loadFailed: boolean;
  readonly loaded: boolean;
  readonly notice: HealthKitAutoSyncConfigurationResult['status'] | null;
  readonly onRetryLoad: () => void;
  readonly onRetryStatus: () => void;
  readonly onSave: () => void;
  readonly onToggle: (feature: HealthKitAutoSyncFeature) => void;
  readonly saving: boolean;
  readonly selected: ReadonlySet<HealthKitAutoSyncFeature>;
  readonly statusLoadFailed: boolean;
}) {
  const inset = useNavigationContentInset();
  // Consume the shell's scroll clearance once; the measured wrapper owns horizontal regions.
  const page = (
    <ScrollView
      contentContainerStyle={[styles.panel, inset]}
      style={styles.scroll}
      testID="health-data-scroll"
    >
      <View style={styles.heading}>
        <Text
          accessibilityRole="header"
          style={styles.title}
          testID="health-data-title"
        >
          {t('settings.healthData.title')}
        </Text>
        <Text style={styles.body}>{t('settings.healthData.description')}</Text>
      </View>
      <HealthDataFeatureSelection
        disabled={!loaded || saving}
        onToggle={onToggle}
        selected={selected}
      />
      <Text style={styles.note}>{t('settings.healthData.localOnly')}</Text>
      {loadFailed ? (
        <View style={styles.errorGroup}>
          <Text
            accessibilityRole="alert"
            style={styles.error}
            testID="health-data-load-error"
          >
            {t('settings.healthData.loadError')}
          </Text>
          <AppButton
            onPress={onRetryLoad}
            testID="health-data-load-retry"
            title={t('appointments.retry')}
            variant="secondary"
          />
        </View>
      ) : null}
      <View style={styles.statusCard}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {t('settings.healthData.connection')}
        </Text>
        <Text style={styles.statusText} testID="health-data-connection-status">
          {!integrationStatus && !statusLoadFailed
            ? t('settings.healthData.statusLoading')
            : integrationStatus?.availability === 'available'
              ? t('settings.healthData.connectionAvailable')
              : integrationStatus?.availability === 'unavailable'
                ? t('settings.healthData.connectionUnavailable')
                : t('settings.healthData.connectionUnknown')}
        </Text>
        <Text style={styles.note} testID="health-data-permission-status">
          {t('settings.healthData.permissionNote')}
        </Text>
      </View>
      <View style={styles.statusCard}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {t('settings.healthData.lastSync')}
        </Text>
        <Text style={styles.statusText} testID="health-data-last-sync-status">
          {integrationStatus?.lastSync
            ? integrationStatus.lastSync.status === 'complete'
              ? t('settings.syncStatus.complete')
              : t('settings.syncStatus.retryable')
            : statusLoadFailed
              ? t('settings.healthData.statusLoadError')
              : !integrationStatus
                ? t('settings.healthData.statusLoading')
                : t('settings.syncStatus.noResult')}
        </Text>
        {integrationStatus?.lastSync ? (
          <Text style={styles.note} testID="health-data-last-sync-time">
            {t('settings.syncStatus.updatedAt', {
              timestamp: formatDateTime(
                new Date(integrationStatus.lastSync.updatedAt),
              ),
            })}
          </Text>
        ) : null}
        {statusLoadFailed ? (
          <View style={styles.errorGroup}>
            <Text
              accessibilityRole="alert"
              style={styles.error}
              testID="health-data-status-load-error"
            >
              {t('settings.healthData.statusLoadError')}
            </Text>
            <AppButton
              onPress={onRetryStatus}
              testID="health-data-status-retry"
              title={t('appointments.retry')}
              variant="secondary"
            />
          </View>
        ) : null}
      </View>
      <AppButton
        accessibilityState={{ busy: saving }}
        disabled={!loaded || saving}
        onPress={() => {
          onSave();
        }}
        testID="health-data-save"
        title={
          saving
            ? t('settings.healthData.saving')
            : t('settings.healthData.save')
        }
      />
      <Text
        accessibilityLiveRegion="polite"
        style={styles.status}
        testID="health-data-status"
      >
        {notice === 'complete'
          ? t('settings.healthData.saved')
          : notice === 'retryable'
            ? t('settings.healthData.retryable')
            : notice === 'skipped'
              ? t('settings.healthData.disabled')
              : notice === 'selection_save_failed'
                ? t('settings.healthData.selectionSaveFailed')
                : !loaded && !loadFailed
                  ? t('settings.healthData.loading')
                  : ''}
      </Text>
    </ScrollView>
  );

  return (
    <AdaptiveColumns
      primary={page}
      routeKey="settings-health-data"
      testID="health-data-layout"
    />
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  panel: {
    flexGrow: 1,
    backgroundColor: appColors.background,
    gap: 16,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 32,
  },
  heading: { gap: 8 },
  title: { color: appColors.text, fontSize: 30, fontWeight: '700' },
  body: { color: appColors.secondary, fontSize: 15, lineHeight: 22 },
  note: { color: appColors.secondary, fontSize: 13, lineHeight: 19 },
  statusCard: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
    padding: 16,
  },
  sectionTitle: { color: appColors.text, fontSize: 17, fontWeight: '700' },
  statusText: { color: appColors.text, fontSize: 14, lineHeight: 21 },
  status: {
    color: appColors.secondary,
    fontSize: 14,
    lineHeight: 20,
    minHeight: 20,
  },
  error: { color: appColors.danger, fontSize: 14, lineHeight: 20 },
  errorGroup: { gap: 8 },
});
