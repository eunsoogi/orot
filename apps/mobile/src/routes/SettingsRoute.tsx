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
}

/** Collects existing provider, account, permission, and backup settings in one root. */
export function SettingsRoute({
  selectedProvider,
  onOpenProviderSettings,
  onOpenAccounts,
  onOpenPrivacy,
  onOpenBackup,
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
        <Text style={styles.sectionTitle}>{t('settings.aiAccounts')}</Text>
        <View style={styles.group}>
          <SettingRow
            symbol="brain"
            onPress={onOpenProviderSettings}
            summary={selectedProvider || t('settings.providerSummary')}
            testID="settings-open-provider"
            title={t('settings.provider')}
          />
          <View style={styles.divider} />
          <SettingRow
            symbol="person"
            onPress={onOpenAccounts}
            testID="settings-open-accounts"
            title={t('settings.accounts')}
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('settings.dataPrivacy')}</Text>
        <View style={styles.group}>
          <SettingRow
            symbol="lock"
            onPress={onOpenPrivacy}
            testID="settings-open-privacy"
            title={t('settings.permissions')}
          />
          <View style={styles.divider} />
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
}: {
  readonly onPress: () => void;
  readonly summary?: string;
  readonly testID: string;
  readonly title: string;
  readonly symbol: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={styles.row}
      testID={testID}
    >
      <AppSymbol name={symbol} size={24} color={appColors.text} />
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{title}</Text>
        {summary ? <Text style={styles.summary}>{summary}</Text> : null}
      </View>
      <AppSymbol name="chevron.right" size={14} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: appColors.background,
    gap: 32,
    paddingHorizontal: 24,
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
