import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import { useNavigationLeaveStateRegistration } from '../navigation';

/** Explains existing permission boundaries and sends permission changes to iOS Settings. */
export function SettingsPrivacyRoute() {
  const [settingsError, setSettingsError] = useState(false);
  useNavigationLeaveStateRegistration({
    canLeave: true,
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: false,
    revision: 0,
    inputRevision: 0,
  });

  function openSystemSettings() {
    setSettingsError(false);
    // Permission ownership stays with iOS; the app never presents pretend toggles.
    return Linking.openSettings().catch(() => setSettingsError(true));
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      style={styles.scrollView}
    >
      <Text
        accessibilityRole="header"
        style={styles.title}
        testID="settings-privacy-title"
      >
        {t('settings.permissions')}
      </Text>

      <View style={styles.section}>
        <PermissionRow
          summary={t('settings.permission.microphone')}
          title={t('settings.permission.microphoneTitle')}
        />
        <PermissionRow
          summary={t('settings.permission.speechRecognition')}
          title={t('settings.permission.speechRecognitionTitle')}
        />
        <PermissionRow
          detail={t('healthkit.commonObservations.localOnly')}
          summary={t('settings.permission.healthData')}
          title={t('settings.healthPrivacy')}
        />
        <PermissionRow
          detail={t('calendar.permissionExplanation')}
          summary={t('settings.permission.calendar')}
          title={t('settings.calendarPrivacy')}
        />
      </View>

      <View style={styles.externalSection}>
        <Text style={styles.sectionTitle}>
          {t('settings.externalTransfer')}
        </Text>
        <Text style={styles.body}>{t('settings.externalTransferSummary')}</Text>
        <Text style={styles.detail}>
          {t('provider.selection.remotePrivacy')}
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={openSystemSettings}
        style={styles.settingsAction}
        testID="privacy-open-system-settings"
      >
        <Text style={styles.settingsActionTitle}>
          {t('settings.openSystemSettings')}
        </Text>
        <Text accessibilityElementsHidden style={styles.chevron}>
          ›
        </Text>
      </Pressable>
      {settingsError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {t('settings.openSystemSettingsError')}
        </Text>
      ) : null}
    </ScrollView>
  );
}

function PermissionRow({
  detail,
  summary,
  title,
}: {
  readonly detail?: string;
  readonly summary: string;
  readonly title: string;
}) {
  return (
    <View style={styles.permissionRow}>
      <Text style={styles.rowTitle}>{title}</Text>
      <Text style={styles.body}>{summary}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  scrollView: { flex: 1 },
  container: {
    flexGrow: 1,
    backgroundColor: appColors.background,
    gap: 20,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 32,
  },
  title: { color: appColors.text, fontSize: 30, fontWeight: '700' },
  section: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
  },
  permissionRow: {
    gap: 5,
    paddingVertical: 14,
    borderBottomColor: appColors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowTitle: { color: appColors.text, fontSize: 16, fontWeight: '600' },
  body: { color: appColors.text, fontSize: 14, lineHeight: 21 },
  detail: { color: appColors.secondary, fontSize: 13, lineHeight: 19 },
  externalSection: {
    backgroundColor: appColors.surface,
    borderRadius: 18,
    gap: 8,
    padding: 16,
  },
  sectionTitle: { color: appColors.text, fontSize: 16, fontWeight: '600' },
  settingsAction: {
    alignItems: 'center',
    backgroundColor: appColors.surface,
    borderRadius: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: 16,
  },
  settingsActionTitle: {
    color: appColors.primary,
    fontSize: 15,
    fontWeight: '600',
  },
  chevron: { color: appColors.primary, fontSize: 24, marginLeft: 12 },
  error: { color: appColors.danger, fontSize: 14 },
});
