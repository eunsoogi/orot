import { NativeModules, StyleSheet, View } from 'react-native';
import { AdaptiveColumns } from '../layout/AdaptiveColumns';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import { appColors } from '../layout/appColors';
import { useNavigationLeaveStateRegistration } from '../navigation';
import { SettingsRouteAppInfo, SettingsRouteRow } from './SettingsRouteRows';

interface SettingsRouteProps {
  readonly selectedProvider: string;
  readonly onOpenProviderSettings: () => void;
  readonly onOpenAccounts: () => void;
  readonly onOpenPrivacy: () => void;
  readonly onOpenBackup: () => void;
  readonly onOpenHealthData: () => void;
  readonly onOpenSyncStatus: () => void;
}

/** Keeps Settings actions in place while its content follows measured usable space. */
export function SettingsRoute({
  selectedProvider,
  onOpenProviderSettings,
  onOpenAccounts,
  onOpenPrivacy,
  onOpenBackup,
  onOpenHealthData,
  onOpenSyncStatus,
}: SettingsRouteProps) {
  useNavigationLeaveStateRegistration({
    canLeave: true,
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: false,
    revision: 0,
    inputRevision: 0,
  });
  const version = (
    NativeModules.OrotAppMetadata as { version?: string } | undefined
  )?.version;
  return (
    <View style={styles.container}>
      {/* Keep all settings sections in a single usable region. */}
      <AdaptiveColumns
        primary={
          <View style={styles.panel}>
            <Text
              accessibilityRole="header"
              style={styles.title}
              testID="settings-title"
            >
              {t('settings.title')}
            </Text>

            <View style={styles.section} testID="settings-section-integrations">
              <Text style={styles.sectionTitle}>
                {t('settings.integrations')}
              </Text>
              <View style={styles.group}>
                <SettingsRouteRow
                  symbol="heart.fill"
                  tone="pink"
                  onPress={onOpenHealthData}
                  summary={t('settings.healthDataSummary')}
                  testID="settings-open-health-data"
                  title={t('settings.healthData')}
                />
                <View style={styles.divider} />
                <SettingsRouteRow
                  symbol="arrow.triangle.2.circlepath"
                  onPress={onOpenSyncStatus}
                  summary={t('settings.syncStatusSummary')}
                  testID="settings-open-sync-status"
                  title={t('settings.syncStatus')}
                />
              </View>
            </View>

            <View style={styles.section} testID="settings-section-other">
              <Text style={styles.sectionTitle}>
                {t('settings.otherSettings')}
              </Text>
              <View style={styles.group}>
                <SettingsRouteRow
                  symbol="sparkles"
                  tone="purple"
                  onPress={onOpenProviderSettings}
                  summary={selectedProvider || t('settings.providerSummary')}
                  testID="settings-open-provider"
                  title={t('settings.provider')}
                />
                <View style={styles.divider} />
                <SettingsRouteRow
                  symbol="person"
                  tone="neutral"
                  onPress={onOpenAccounts}
                  testID="settings-open-accounts"
                  title={t('settings.accounts')}
                />
                <View style={styles.divider} />
                <SettingsRouteRow
                  symbol="checkmark.shield"
                  tone="green"
                  onPress={onOpenPrivacy}
                  testID="settings-open-privacy"
                  title={t('settings.permissions')}
                />
              </View>
            </View>
            <View
              style={styles.section}
              testID="settings-section-data-management"
            >
              <Text style={styles.sectionTitle}>
                {t('settings.dataManagement')}
              </Text>
              <View style={styles.group}>
                <SettingsRouteRow
                  symbol="externaldrive"
                  onPress={onOpenBackup}
                  testID="settings-open-backup"
                  title={t('backup.pageTitle')}
                />
              </View>
            </View>

            <View style={styles.section} testID="settings-section-app-info">
              <Text style={styles.sectionTitle}>{t('settings.appInfo')}</Text>
              <View style={styles.group}>
                <SettingsRouteAppInfo version={version} />
              </View>
            </View>
          </View>
        }
        routeKey="settings"
        testID="settings-layout"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    minWidth: 0,
    backgroundColor: appColors.background,
  },
  panel: {
    flexGrow: 1,
    minWidth: 0,
    gap: 20,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 28,
  },
  title: { color: appColors.text, fontSize: 36, fontWeight: '700' },
  section: { gap: 8 },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: appColors.border,
    marginHorizontal: 16,
  },
  group: {
    backgroundColor: appColors.surface,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: appColors.border,
    overflow: 'hidden',
  },
  sectionTitle: {
    color: appColors.secondary,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
});
