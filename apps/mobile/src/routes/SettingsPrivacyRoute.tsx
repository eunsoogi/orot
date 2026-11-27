import { useCallback, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import { AdaptiveColumns } from '../layout/AdaptiveColumns';
import { useNavigationLeaveStateRegistration } from '../navigation';
import { useNavigationEdgeVerticalScroll } from '../navigation/navigationEdgeScroll';
import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import { settingsListColors } from './settingsListColors';
import { SettingsInformationButton } from './SettingsInformationButton';
import { InferenceConsentSettings } from '../agent/execution/InferenceConsentSettings';

/** Measures privacy panels while keeping OS-owned permissions and consent scope explicit. */
export function SettingsPrivacyRoute({
  policy = false,
}: { readonly policy?: boolean } = {}) {
  const navigationInset = useNavigationContentInset();
  // This page owns the scroll viewport; the panels retain their readable inset.
  const edge = useNavigationEdgeVerticalScroll({
    trailingPadding:
      navigationInset.paddingRight ?? styles.container.paddingHorizontal,
  });
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
      {...edge.indicatorProps}
      contentContainerStyle={[
        styles.container,
        navigationInset,
        edge.contentStyle,
      ]}
      style={[styles.scrollView, edge.scrollViewStyle]}
    >
      <AdaptiveColumns
        primary={
          <View style={styles.pageSections}>
            <Text
              accessibilityRole="header"
              style={styles.title}
              testID={
                policy
                  ? 'settings-privacy-policy-title'
                  : 'settings-privacy-title'
              }
            >
              {t(policy ? 'settings.privacyPolicy' : 'settings.permissions')}
            </Text>
            {!policy ? (
              <View style={styles.secondaryColumn}>
                <View
                  style={styles.section}
                  testID="settings-privacy-permissions"
                >
                  <PermissionRow
                    testID="privacy-microphone-information"
                    summary={t('settings.permission.microphone')}
                    title={t('settings.permission.microphoneTitle')}
                  />
                  <PermissionRow
                    testID="privacy-speech-information"
                    summary={t('settings.permission.speechRecognition')}
                    title={t('settings.permission.speechRecognitionTitle')}
                  />
                  <PermissionRow
                    detail={t('healthkit.commonObservations.localOnly')}
                    testID="privacy-health-information"
                    summary={t('settings.permission.healthData')}
                    title={t('settings.healthPrivacy')}
                  />
                  <PermissionRow
                    detail={t('calendar.permissionExplanation')}
                    testID="privacy-calendar-information"
                    summary={t('settings.permission.calendar')}
                    title={t('settings.calendarPrivacy')}
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
            ) : (
              <View style={styles.secondaryColumn}>
                <View
                  style={styles.externalSection}
                  testID="settings-privacy-policy-summary"
                >
                  <Text accessibilityRole="header" style={styles.policyTitle}>
                    {t('settings.externalTransfer')}
                  </Text>
                  <Text style={styles.policyBody}>
                    {t('settings.externalTransferSummary')}
                  </Text>
                  <Text style={styles.policyBody}>
                    {t('provider.selection.remotePrivacy')}
                  </Text>
                </View>
                <View
                  style={styles.externalSection}
                  testID="settings-privacy-external-transfer"
                >
                  <InferenceConsentSettings
                    onClearingChange={handleConsentClearingChange}
                  />
                </View>
              </View>
            )}
          </View>
        }
        routeKey={policy ? 'settings-privacy-policy' : 'settings-privacy'}
        testID="settings-privacy-columns"
      />
    </ScrollView>
  );
}

function PermissionRow({
  detail,
  summary,
  testID,
  title,
}: {
  readonly detail?: string;
  readonly summary: string;
  readonly testID: string;
  readonly title: string;
}) {
  return (
    <View style={[styles.row, styles.permissionRow]}>
      <Text style={styles.rowTitle}>{title}</Text>
      <SettingsInformationButton
        title={title}
        message={detail ? `${summary}\n\n${detail}` : summary}
        testID={testID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  scrollView: { flex: 1 },
  container: {
    flexGrow: 1,
    gap: 20,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 32,
  },
  title: { color: appColors.text, fontSize: 30, fontWeight: '700' },
  pageSections: { gap: 20 },
  section: {
    backgroundColor: settingsListColors.row,
    borderColor: appColors.border,
    borderRadius: 18,
    borderWidth: 0,
    paddingHorizontal: 16,
  },
  row: {
    minHeight: 48,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  permissionRow: {
    borderBottomColor: settingsListColors.separator,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowTitle: { flex: 1, color: appColors.text, fontSize: 16 },
  externalSection: {
    backgroundColor: settingsListColors.row,
    borderRadius: 18,
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  policyTitle: { color: appColors.text, fontSize: 16, fontWeight: '600' },
  policyBody: { color: appColors.secondary, fontSize: 14, lineHeight: 21 },
  secondaryColumn: { gap: 12, minWidth: 0 },
  settingsAction: {
    alignItems: 'center',
    backgroundColor: settingsListColors.row,
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
