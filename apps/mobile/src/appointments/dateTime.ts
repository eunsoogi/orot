import { t } from '../i18n';

export interface LocalAppointmentDateTime {
  date: string;
  time: string;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

function timeZoneParts(value: Date, timeZone: string): Record<string, number> {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  return Object.fromEntries(
    formatted
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, Number(part.value)]),
  );
}

function offsetAt(utcMilliseconds: number, timeZone: string): number {
  const parts = timeZoneParts(new Date(utcMilliseconds), timeZone);
  return (
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    ) - utcMilliseconds
  );
}

function matchesLocalInput(
  parts: Record<string, number>,
  expected: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
  },
): boolean {
  return (
    parts.year === expected.year &&
    parts.month === expected.month &&
    parts.day === expected.day &&
    parts.hour === expected.hour &&
    parts.minute === expected.minute
  );
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function toAppointmentTimestamp(
  dateText: string,
  timeText: string,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string | null {
  const dateParts = DATE_PATTERN.exec(dateText.trim());
  const timeParts = TIME_PATTERN.exec(timeText.trim());
  if (!dateParts || !timeParts) return null;

  const [, yearText, monthText, dayText] = dateParts;
  const [, hourText, minuteText] = timeParts;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (month < 1 || month > 12 || hour > 23 || minute > 59) return null;

  const wallDate = new Date(Date.UTC(year, month - 1, day));
  if (
    wallDate.getUTCFullYear() !== year ||
    wallDate.getUTCMonth() !== month - 1 ||
    wallDate.getUTCDate() !== day
  ) {
    return null;
  }

  const expected = { year, month, day, hour, minute };
  const wallMilliseconds = Date.UTC(year, month - 1, day, hour, minute);
  const firstGuess = wallMilliseconds - offsetAt(wallMilliseconds, timeZone);
  const instant = wallMilliseconds - offsetAt(firstGuess, timeZone);
  if (!matchesLocalInput(timeZoneParts(new Date(instant), timeZone), expected))
    return null;
  return new Date(instant).toISOString();
}

export function toLocalAppointmentDateTime(
  timestamp: string,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): LocalAppointmentDateTime {
  const value = new Date(timestamp);
  if (!Number.isFinite(value.getTime()))
    throw new Error(t('appointments.errors.invalidTime'));
  const parts = timeZoneParts(value, timeZone);
  return {
    date: [parts.year, pad(parts.month), pad(parts.day)].join('-'),
    time: [pad(parts.hour), pad(parts.minute)].join(':'),
  };
}

export function toAppointmentTimestampForEdit(
  originalTimestamp: string,
  dateText: string,
  timeText: string,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string | null {
  const originalLocalTime = toLocalAppointmentDateTime(
    originalTimestamp,
    timeZone,
  );
  if (
    dateText.trim() === originalLocalTime.date &&
    timeText.trim() === originalLocalTime.time
  ) {
    return originalTimestamp;
  }
  return toAppointmentTimestamp(dateText, timeText, timeZone);
}
