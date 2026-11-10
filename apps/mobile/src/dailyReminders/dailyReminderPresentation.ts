import type { DailyReminderPreference } from './nativeDailyReminder';
import { formatTime } from '../i18n';

/** Formats a stored wall-clock value without applying the current date's DST rules. */
export function formatDailyReminderTime(hour: number, minute: number): string {
  return formatTime(new Date(Date.UTC(2000, 0, 1, hour, minute)), 'UTC');
}

/** Supplies a Date carrier for the picker while retaining only local clock fields. */
export function dailyReminderPickerDate(
  preference: DailyReminderPreference | null,
): Date {
  if (preference == null) return new Date();
  return new Date(2000, 0, 15, preference.hour, preference.minute);
}
