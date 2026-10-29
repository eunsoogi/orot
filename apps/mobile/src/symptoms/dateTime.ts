const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Interprets device-local wall time, rejects calendar rollover, and returns a UTC ISO instant. */
export function toSymptomTimestamp(
  dateText: string,
  timeText: string,
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
  if (year < 1000 || month < 1 || month > 12 || hour > 23 || minute > 59)
    return null;

  const value = new Date(year, month - 1, day, hour, minute);
  if (
    value.getFullYear() !== year ||
    value.getMonth() !== month - 1 ||
    value.getDate() !== day ||
    value.getHours() !== hour ||
    value.getMinutes() !== minute
  )
    return null;
  return value.toISOString();
}

export function toLocalSymptomDateTime(timestamp: string): {
  date: string;
  time: string;
} {
  const value = new Date(timestamp);
  if (!Number.isFinite(value.getTime()))
    throw new Error('Symptom time is invalid.');
  return {
    date: [
      value.getFullYear(),
      pad(value.getMonth() + 1),
      pad(value.getDate()),
    ].join('-'),
    time: [pad(value.getHours()), pad(value.getMinutes())].join(':'),
  };
}

/** Include the entire displayed minute and both occurrences of a repeated local minute. */
export function toSymptomThroughTimestamp(
  date: string,
  time: string,
): string | null {
  const start = toSymptomTimestamp(date, time);
  if (!start) return null;
  const first = new Date(start);
  const offsets = [-86400000, 0, 86400000].map(delta =>
    new Date(first.getTime() + delta).getTimezoneOffset(),
  );
  const candidates = offsets
    .map(
      offset => first.getTime() + (offset - first.getTimezoneOffset()) * 60000,
    )
    .filter(value => {
      const local = toLocalSymptomDateTime(new Date(value).toISOString());
      return local.date === date.trim() && local.time === time.trim();
    });
  return new Date(Math.max(...candidates) + 59999).toISOString();
}
