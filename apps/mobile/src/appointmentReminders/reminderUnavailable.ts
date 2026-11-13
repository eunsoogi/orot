import { Alert } from 'react-native';
import { t } from '../i18n';

/** A stale appointment is distinct from a temporary storage or navigation failure. */
export function showReminderUnavailable(reason: 'stale' | 'error') {
  Alert.alert(
    t('medicalAppointments.reminder.openTitle'),
    reason === 'stale'
      ? t('medicalAppointments.reminder.stale')
      : t('medicalAppointments.reminder.unavailable'),
  );
}

export function showDailyReminderUnavailable() {
  Alert.alert(t('dailyReminder.openTitle'), t('dailyReminder.openError'));
}
