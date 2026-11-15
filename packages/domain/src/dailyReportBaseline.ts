import { compareTimestamps } from './common';
import { dailyReportCalendarInterval } from './dailyReportCalendar';

/** Prior civil days, not 28 fixed 24-hour durations across daylight-saving changes. */
export function dailyReportBaselineInterval(localDate: string, timeZone: string) {
  const day = dailyReportCalendarInterval(localDate, timeZone);
  if (!day) return null;
  const date = new Date(`${localDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 28);
  const start = dailyReportCalendarInterval(date.toISOString().slice(0, 10), timeZone);
  return start ? { fromInclusive: start.fromInclusive, toExclusive: day.fromInclusive } : null;
}

/** Only explicitly marked historical or recorded-active symptom context may use this exception.
 * They retain their original timestamps; they are never current-day observations. */
export function validDailyReportHistoricalContext(
  record: {
    source: string;
    contextRole?: string;
    supportingRecordFor?: readonly string[];
    occurrence: { startInclusive: string; endExclusive?: string };
  },
  localDate: string,
  timeZone: string,
) {
  // Ongoing status is admitted from an explicitly active source record, never inferred
  // from a missing resolution field. Keep onset unchanged, even when much older.
  if (record.contextRole === 'ongoing_symptom') {
    const day = dailyReportCalendarInterval(localDate, timeZone);
    return Boolean(
      day &&
      record.source === 'symptom_entry' &&
      !record.supportingRecordFor &&
      !record.occurrence.endExclusive &&
      compareTimestamps(record.occurrence.startInclusive, day.fromInclusive) < 0,
    );
  }
  if (
    (!(
      (record.contextRole === 'personal_baseline' || record.contextRole === 'activity_history') &&
      record.source === 'health_observation'
    ) &&
      !(record.contextRole === 'medication_history' && record.source === 'dose_event')) ||
    record.supportingRecordFor
  )
    return false;
  const range = dailyReportBaselineInterval(localDate, timeZone);
  return Boolean(
    range &&
    compareTimestamps(record.occurrence.startInclusive, range.fromInclusive) >= 0 &&
    compareTimestamps(record.occurrence.startInclusive, range.toExclusive) < 0 &&
    (!record.occurrence.endExclusive ||
      compareTimestamps(record.occurrence.endExclusive, range.toExclusive) <= 0),
  );
}

export const validDailyReportBaseline: typeof validDailyReportHistoricalContext = (
  record,
  date,
  zone,
) =>
  record.contextRole === 'personal_baseline' &&
  validDailyReportHistoricalContext(record, date, zone);
