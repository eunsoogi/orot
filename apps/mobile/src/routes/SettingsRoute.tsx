import { NativeModules, StyleSheet, View } from 'react-native';
import { AdaptiveColumns } from '../layout/AdaptiveColumns';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import { appColors } from '../layout/appColors';
import { useNavigationLeaveStateRegistration } from '../navigation';
import type { SelectedAiResolverOptions } from '../aiFeatures/integration/provider';
import { NAVIGATION_CONTENT_GAP } from '../navigation/navigationLayout';
import { SettingsRouteAppInfo, SettingsRouteRow } from './SettingsRouteRows';
import { settingsListColors } from './settingsListColors';
import { processDiagnosticWitnessEnabled } from '../providers/processDiagnosticWitness';
import { ProcessDiagnosticWitnessSection } from './ProcessDiagnosticWitnessSection';

interface SettingsRouteProps {
  readonly selectedProvider: string;
  readonly selectedAiResolverOptions?: SelectedAiResolverOptions;
  readonly onOpenProviderSettings: () => void;
  readonly onOpenAccounts: () => void;
  readonly onOpenPrivacy: () => void;
  readonly onOpenBackup: () => void;
  readonly onOpenHealthData: () => void;
  readonly onOpenSyncStatus: () => void;
  readonly onOpenNotifications: () => void;
  readonly onOpenMemory: () => void;
}

/** The root list only navigates; persisted controls mount on their own screens. */
export function SettingsRoute({
  onOpenProviderSettings,
  onOpenAccounts,
  onOpenPrivacy,
  onOpenBackup,
  onOpenHealthData,
  onOpenSyncStatus,
  onOpenNotifications,
  onOpenMemory,
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
      <AdaptiveColumns
        primary={
          <View style={styles.panel} testID="settings-panel">
            <Text
              accessibilityRole="header"
              style={styles.title}
              testID="settings-title"
            >
              {t('settings.title')}
            </Text>
            <View style={styles.list} testID="settings-destinations">
              <SettingsRouteRow
                symbol="sparkles"
                tone="purple"
                title={t('settings.provider')}
                onPress={onOpenProviderSettings}
                testID="settings-open-provider"
              />
              <SettingsRouteRow
                symbol="person.crop.circle"
                tone="purple"
                title={t('settings.accounts')}
                onPress={onOpenAccounts}
                testID="settings-open-accounts"
              />
              <SettingsRouteRow
                symbol="heart.fill"
                tone="pink"
                title={t('settings.healthData')}
                onPress={onOpenHealthData}
                testID="settings-open-health-data"
              />
              <SettingsRouteRow
                symbol="arrow.triangle.2.circlepath"
                title={t('settings.syncStatus')}
                onPress={onOpenSyncStatus}
                testID="settings-open-sync-status"
              />
              <SettingsRouteRow
                symbol="bell.fill"
                tone="pink"
                title={t('settings.notifications')}
                onPress={onOpenNotifications}
                testID="settings-open-notifications"
              />
              <SettingsRouteRow
                symbol="checkmark.shield"
                tone="green"
                title={t('settings.permissions')}
                onPress={onOpenPrivacy}
                testID="settings-open-privacy"
              />
              <SettingsRouteRow
                symbol="bookmark.fill"
                tone="purple"
                title={t('settings.memory')}
                onPress={onOpenMemory}
                testID="settings-open-memory"
              />
              <SettingsRouteRow
                symbol="externaldrive"
                title={t('backup.pageTitle')}
                onPress={onOpenBackup}
                testID="settings-open-backup"
              />
              <SettingsRouteAppInfo version={version} />
              {processDiagnosticWitnessEnabled() ? (
                <ProcessDiagnosticWitnessSection />
              ) : null}
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
    backgroundColor: settingsListColors.background,
  },
  panel: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 680,
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    // The outer route scroller already supplies the navigation gap.
    paddingBottom: 28 - NAVIGATION_CONTENT_GAP,
  },
  title: { color: appColors.text, fontSize: 34, fontWeight: '700' },
  list: {
    backgroundColor: settingsListColors.row,
    borderRadius: 20,
    overflow: 'hidden',
  },
});
