import { NativeModules, Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
import { t } from '../i18n';
import { appColors } from '../layout/appColors';
import { useNavigationLeaveStateRegistration } from '../navigation';

interface SettingsRouteProps {
  readonly selectedProvider: string;
  readonly onOpenProviderSettings: () => void;
  readonly onOpenAccounts: () => void;
  readonly onOpenPrivacy: () => void;
  readonly onOpenBackup: () => void;
  readonly onOpenHealthData: () => void;
  readonly onOpenSyncStatus: () => void;
}

/** Separates automatic integrations from provider, privacy, and backup settings. */
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
      <Text
        accessibilityRole="header"
        style={styles.title}
        testID="settings-title"
      >
        {t('settings.title')}
      </Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('settings.integrations')}</Text>
        <View style={styles.group}>
          <SettingRow
            symbol="heart.fill"
            tone="pink"
            onPress={onOpenHealthData}
            summary={t('settings.healthDataSummary')}
            testID="settings-open-health-data"
            title={t('settings.healthData')}
          />
          <View style={styles.divider} />
          <SettingRow
            symbol="arrow.triangle.2.circlepath"
            onPress={onOpenSyncStatus}
            summary={t('settings.syncStatusSummary')}
            testID="settings-open-sync-status"
            title={t('settings.syncStatus')}
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('settings.otherSettings')}</Text>
        <View style={styles.group}>
          <SettingRow
            symbol="sparkles"
            tone="purple"
            onPress={onOpenProviderSettings}
            summary={selectedProvider || t('settings.providerSummary')}
            testID="settings-open-provider"
            title={t('settings.provider')}
          />
          <View style={styles.divider} />
          <SettingRow
            symbol="person"
            tone="neutral"
            onPress={onOpenAccounts}
            testID="settings-open-accounts"
            title={t('settings.accounts')}
          />
          <View style={styles.divider} />
          <SettingRow
            symbol="checkmark.shield"
            tone="green"
            onPress={onOpenPrivacy}
            testID="settings-open-privacy"
            title={t('settings.permissions')}
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('settings.dataManagement')}</Text>
        <View style={styles.group}>
          <SettingRow
            symbol="externaldrive"
            onPress={onOpenBackup}
            testID="settings-open-backup"
            title={t('backup.pageTitle')}
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('settings.appInfo')}</Text>
        <View style={[styles.group, styles.row]} testID="settings-app-info">
          <AppSymbol name="info.circle" size={24} color={appColors.text} />
          <Text style={styles.rowTitle}>
            {t('app.welcome.title')}
            {version ? ` ${version}` : ''}
          </Text>
        </View>
      </View>
    </View>
  );
}

function SettingRow({
  onPress,
  summary,
  testID,
  title,
  symbol,
  tone = 'blue',
}: {
  readonly onPress: () => void;
  readonly summary?: string;
  readonly testID: string;
  readonly title: string;
  readonly symbol: string;
  readonly tone?: 'blue' | 'green' | 'pink' | 'purple' | 'neutral';
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={styles.row}
      testID={testID}
    >
      <View style={[styles.icon, { backgroundColor: tones[tone].background }]}>
        <AppSymbol name={symbol} size={24} color={tones[tone].foreground} />
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{title}</Text>
        {summary ? <Text style={styles.summary}>{summary}</Text> : null}
      </View>
      <AppSymbol name="chevron.right" size={14} />
    </Pressable>
  );
}

// Semantic icon colors follow system appearance, including the tinted backgrounds.
const tones = {
  blue: {
    foreground: appColors.primaryText,
    background: appColors.primarySoft,
  },
  green: { foreground: appColors.green, background: appColors.greenSoft },
  pink: { foreground: appColors.pink, background: appColors.pinkSoft },
  purple: { foreground: appColors.purple, background: appColors.purpleSoft },
  neutral: {
    foreground: appColors.secondary,
    background: appColors.background,
  },
};

const styles = StyleSheet.create({
  icon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    flexGrow: 1,
    backgroundColor: appColors.background,
    gap: 24,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 28,
  },
  title: { color: appColors.text, fontSize: 40, fontWeight: '700' },
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
  row: {
    alignItems: 'center',
    backgroundColor: appColors.surface,
    flexDirection: 'row',
    gap: 16,
    minHeight: 64,
    paddingHorizontal: 16,
  },
  rowCopy: { flex: 1, gap: 4, paddingVertical: 10 },
  rowTitle: { color: appColors.text, fontSize: 16, fontWeight: '500' },
  summary: { color: appColors.secondary, fontSize: 13 },
});
