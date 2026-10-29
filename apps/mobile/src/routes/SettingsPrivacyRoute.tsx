import { useCallback, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import { AdaptiveColumns } from '../layout/AdaptiveColumns';
import { useNavigationLeaveStateRegistration } from '../navigation';
import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import { InferenceConsentSettings } from '../agent/execution/InferenceConsentSettings';

/** Measures privacy panels while keeping OS-owned permissions and consent scope explicit. */
export function SettingsPrivacyRoute() {
  const navigationInset = useNavigationContentInset();
  const [settingsError, setSettingsError] = useState(false);
  const [isClearingConsent, setIsClearingConsent] = useState(false);
  const handleConsentClearingChange = useCallback((clearing: boolean) => {
    setIsClearingConsent(clearing);
  }, []);
  useNavigationLeaveStateRegistration({
    canLeave: !isClearingConsent,
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: isClearingConsent,
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
      testID="settings-privacy-scroll"
      contentContainerStyle={[styles.container, navigationInset]}
      style={styles.scrollView}
    >
      <Text
        accessibilityRole="header"
        style={styles.title}
        testID="settings-privacy-title"
      >
        {t('settings.permissions')}
      </Text>

      <AdaptiveColumns
        primary={
          <View style={styles.section} testID="settings-privacy-permissions">
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
        }
        secondary={
          <View
            style={styles.secondaryColumn}
            testID="settings-privacy-external-transfer"
          >
            <View style={styles.externalSection}>
              <Text style={styles.sectionTitle}>
                {t('settings.externalTransfer')}
              </Text>
              <Text style={styles.body}>
                {t('settings.externalTransferSummary')}
              </Text>
              <Text style={styles.detail}>
                {t('provider.selection.remotePrivacy')}
              </Text>
              <InferenceConsentSettings
                onClearingChange={handleConsentClearingChange}
              />
            </View>

            <Pressable
              accessibilityState={{ disabled: isClearingConsent }}
              accessibilityRole="button"
              disabled={isClearingConsent}
              onPress={openSystemSettings}
              style={[
                styles.settingsAction,
                isClearingConsent && styles.disabledAction,
              ]}
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
              <Text
                accessibilityRole="alert"
                style={styles.error}
                testID="privacy-open-system-settings-error"
              >
                {t('settings.openSystemSettingsError')}
              </Text>
            ) : null}
          </View>
        }
        routeKey="settings-privacy"
        testID="settings-privacy-columns"
      />
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
    paddingHorizontal: 20,
    paddingTop: 16,
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
  secondaryColumn: { gap: 12, minWidth: 0 },
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
  disabledAction: { opacity: 0.45 },
  settingsActionTitle: {
    color: appColors.primary,
    fontSize: 15,
    fontWeight: '600',
  },
  chevron: { color: appColors.primary, fontSize: 24, marginLeft: 12 },
  error: { color: appColors.danger, fontSize: 14 },
});
