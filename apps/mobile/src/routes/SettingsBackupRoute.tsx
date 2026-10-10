import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import BackupStatusRecovery from '../backup/BackupStatusRecovery';
import type { BackupPreparationDisplayState } from '../backup/useBackupPreparation';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import { useNavigationLeaveStateRegistration } from '../navigation';

interface SettingsBackupRouteProps {
  readonly state: BackupPreparationDisplayState;
  readonly onPrepare: () => Promise<void>;
}

/** Reports local preparation separately from iCloud completion owned by iOS. */
export function SettingsBackupRoute({
  state,
  onPrepare,
}: SettingsBackupRouteProps) {
  const navigationInset = useNavigationContentInset();
  const [settingsError, setSettingsError] = useState(false);
  useNavigationLeaveStateRegistration({
    canLeave: true,
    hasUnsavedChanges: false,
    isRecording: false,
    // App owns the preparation task, which continues when this detail is closed.
    hasOngoingOperation: false,
    revision: 0,
    inputRevision: 0,
  });

  function openSystemSettings() {
    setSettingsError(false);
    // iOS owns the cloud-backup truth, so this opens its app settings page.
    return Linking.openSettings().catch(() => setSettingsError(true));
  }

  return (
    <ScrollView
      contentContainerStyle={[styles.container, navigationInset]}
      style={styles.scrollView}
      testID="settings-backup-scroll"
    >
      <Text
        accessibilityRole="header"
        style={styles.title}
        testID="settings-backup-title"
      >
        {t('backup.pageTitle')}
      </Text>
      <Text style={styles.subtitle}>{t('backup.pageDescription')}</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('backup.localPreparation')}</Text>
        <BackupStatusRecovery state={state} onRetry={onPrepare} />
      </View>

      <View style={styles.recoverySection}>
        <View style={styles.recoveryStatus}>
          <Text style={styles.sectionTitle}>{t('backup.recoveryStatus')}</Text>
          <Text style={styles.statusValue}>
            {t('backup.recoveryNotChecked')}
          </Text>
        </View>
        <Text style={styles.body}>{t('backup.icloudGuidance')}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={openSystemSettings}
          style={styles.settingsAction}
          testID="backup-open-system-settings"
        >
          <Text style={styles.actionTitle}>{t('backup.openSettings')}</Text>
          <Text accessibilityElementsHidden style={styles.chevron}>
            ›
          </Text>
        </Pressable>
      </View>
      {settingsError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {t('settings.openSystemSettingsError')}
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollView: { flex: 1 },
  container: {
    flexGrow: 1,
    backgroundColor: appColors.background,
    gap: 18,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 32,
  },
  title: { color: appColors.text, fontSize: 30, fontWeight: '700' },
  subtitle: { color: appColors.secondary, fontSize: 15, lineHeight: 22 },
  section: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
    padding: 16,
  },
  sectionTitle: { color: appColors.secondary, fontSize: 14, fontWeight: '600' },
  recoverySection: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
    padding: 16,
  },
  recoveryStatus: { gap: 6 },
  statusValue: { color: appColors.text, fontSize: 22, fontWeight: '700' },
  body: { color: appColors.secondary, fontSize: 14, lineHeight: 21 },
  settingsAction: {
    alignItems: 'center',
    borderTopColor: appColors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 48,
    paddingTop: 8,
  },
  actionTitle: { color: appColors.primary, fontSize: 15, fontWeight: '600' },
  chevron: { color: appColors.primary, fontSize: 24 },
  error: { color: appColors.danger, fontSize: 14 },
});
