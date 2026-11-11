import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import type { DailyReminderPreference } from '../dailyReminders/nativeDailyReminder';
import { formatDailyReminderTime } from '../dailyReminders/dailyReminderPresentation';
import type { DailyReminderSettingsState } from '../dailyReminders/useDailyReminderSettings';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';

interface SettingsDailyReminderStatusProps {
  readonly onRetry: () => void;
  readonly preference: DailyReminderPreference | null;
  readonly state: DailyReminderSettingsState;
}

/** Shows reminder state in the padded card footer with recovery actions. */
export function SettingsDailyReminderStatus({
  onRetry,
  preference,
  state,
}: SettingsDailyReminderStatusProps) {
  const [openSettingsError, setOpenSettingsError] = useState(false);
  const statusMessage = state.loading
    ? t('settings.dailyReminder.loading')
    : state.loadError
      ? t('settings.dailyReminder.loadError')
      : state.saving
        ? t('settings.dailyReminder.saving')
        : state.saveError
          ? t('settings.dailyReminder.saveError')
          : state.status === 'scheduled' && preference != null
            ? t('settings.dailyReminder.scheduled', {
                time: formatDailyReminderTime(
                  preference.hour,
                  preference.minute,
                ),
              })
            : state.status === 'scheduled'
              ? t('settings.dailyReminder.scheduleError')
              : state.status === 'denied'
                ? t('settings.dailyReminder.denied')
                : state.status === 'disabled'
                  ? t('settings.dailyReminder.disabled')
                  : state.authorization === 'notDetermined'
                    ? t('settings.dailyReminder.authorizationUnknown')
                    : t('settings.dailyReminder.scheduleError');

  const shouldOfferSettings = state.status === 'denied';
  const shouldOfferRetry =
    state.loadError ||
    state.saveError ||
    (state.status === 'error' && !shouldOfferSettings);

  function openSystemSettings() {
    setOpenSettingsError(false);
    Linking.openSettings().catch(() => setOpenSettingsError(true));
  }

  return (
    <View
      style={styles.content}
      testID="settings-daily-reminder-status-content"
    >
      <Text
        accessibilityLiveRegion="polite"
        style={
          state.status === 'scheduled' && !state.loadError
            ? styles.statusText
            : state.status === 'disabled'
              ? styles.statusText
              : styles.statusError
        }
        testID="settings-daily-reminder-status"
      >
        {statusMessage}
      </Text>
      {state.status === 'scheduled' ? (
        <Text style={styles.statusDetail}>
          {t('settings.dailyReminder.deliveryNote')}
        </Text>
      ) : null}
      {shouldOfferSettings || shouldOfferRetry ? (
        <AppButton
          onPress={shouldOfferSettings ? openSystemSettings : onRetry}
          size="compact"
          title={
            shouldOfferSettings
              ? t('settings.dailyReminder.openSettings')
              : t('settings.dailyReminder.retry')
          }
          variant="text"
          testID="settings-daily-reminder-recovery"
        />
      ) : null}
      {openSettingsError ? (
        <Text style={styles.statusError}>
          {t('settings.openSystemSettingsError')}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 4,
    paddingBottom: 16,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  statusText: {
    color: appColors.primaryText,
    fontSize: 14,
  },
  statusError: {
    color: appColors.danger,
    fontSize: 14,
  },
  statusDetail: {
    color: appColors.secondary,
    fontSize: 13,
  },
});
