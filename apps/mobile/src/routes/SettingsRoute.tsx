import { NativeModules, StyleSheet, View } from 'react-native';
import { AdaptiveColumns } from '../layout/AdaptiveColumns';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import { appColors } from '../layout/appColors';
import { useNavigationLeaveStateRegistration } from '../navigation';
import type { SelectedAiResolverOptions } from '../aiFeatures/integration/provider';
import { useSettingsRouteSummaries } from './SettingsRouteAccountSummaries';
import { NAVIGATION_CONTENT_GAP } from '../navigation/navigationLayout';
import { SettingsRouteAppInfo, SettingsRouteRow } from './SettingsRouteRows';
import { SettingsDailyReminderSection } from './SettingsDailyReminderSection';
import { SettingsReplyNotificationSection } from './SettingsReplyNotificationSection';

interface SettingsRouteProps {
  /** Tracks the latest committed choice after persisted resolution confirms it is valid. */
  readonly selectedProvider: string;
  readonly selectedAiResolverOptions?: SelectedAiResolverOptions;
  readonly onOpenProviderSettings: () => void;
  readonly onOpenAccounts: () => void;
  readonly onOpenPrivacy: () => void;
  readonly onOpenBackup: () => void;
  readonly onOpenHealthData: () => void;
  readonly onOpenSyncStatus: () => void;
}

/** Re-reads persisted AI and account state while grouping Settings root destinations. */
export function SettingsRoute({
  selectedProvider,
  selectedAiResolverOptions,
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
  const { selectedAiSummary, accountsSummary } = useSettingsRouteSummaries(
    selectedAiResolverOptions,
    selectedProvider,
  );
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
            <Text style={styles.subtitle}>{t('settings.summary')}</Text>

            <View style={styles.section} testID="settings-section-ai-accounts">
              <Text accessibilityRole="header" style={styles.sectionTitle}>
                {t('settings.aiAccounts')}
              </Text>
              <View style={styles.group}>
                <SettingsRouteRow
                  symbol="sparkles"
                  tone="purple"
                  onPress={onOpenProviderSettings}
                  summary={selectedAiSummary}
                  testID="settings-open-provider"
                  title={t('settings.provider')}
                />
                <View style={styles.divider} />
                <SettingsRouteRow
                  symbol="person"
                  tone="purple"
                  onPress={onOpenAccounts}
                  summary={accountsSummary}
                  testID="settings-open-accounts"
                  title={t('settings.accounts')}
                />
              </View>
            </View>

            <View style={styles.section} testID="settings-section-health-data">
              <Text accessibilityRole="header" style={styles.sectionTitle}>
                {t('settings.healthData')}
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

            <View
              style={styles.section}
              testID="settings-section-privacy-backup"
            >
              <Text accessibilityRole="header" style={styles.sectionTitle}>
                {t('settings.privacyBackup')}
              </Text>
              <View style={styles.group}>
                <SettingsRouteRow
                  symbol="checkmark.shield"
                  tone="green"
                  onPress={onOpenPrivacy}
                  testID="settings-open-privacy"
                  title={t('settings.permissions')}
                />
                <View style={styles.divider} />
                <SettingsRouteRow
                  symbol="externaldrive"
                  onPress={onOpenBackup}
                  testID="settings-open-backup"
                  title={t('backup.pageTitle')}
                />
              </View>
            </View>

            <SettingsDailyReminderSection />
            <SettingsReplyNotificationSection />

            <View style={styles.section} testID="settings-section-app-info">
              <Text accessibilityRole="header" style={styles.sectionTitle}>
                {t('settings.appInfo')}
              </Text>
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
    // The outer route scroller already supplies the navigation gap.
    paddingBottom: 28 - NAVIGATION_CONTENT_GAP,
  },
  title: { color: appColors.text, fontSize: 36, fontWeight: '700' },
  subtitle: { color: appColors.secondary, fontSize: 18 },
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
