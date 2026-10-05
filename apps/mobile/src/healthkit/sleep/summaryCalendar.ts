import { SleepImportError } from './errors';

const dayLengthMs = 24 * 60 * 60 * 1000;

// Split absolute sleep intervals against Gregorian dates in the requested IANA timezone.
export function nextLocalDayBoundary(
  start: number,
  end: number,
  startDay: string,
  formatter: Intl.DateTimeFormat,
): number {
  // Bisect local-date transitions on absolute instants so DST days keep their real elapsed duration.
  if (localDayAt(end, formatter) <= startDay) return end;
  let low = start;
  let high = end;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (localDayAt(middle, formatter) > startDay) high = middle;
    else low = middle;
  }
  return high;
}

export function localDayFormatter(timeZone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    throw new SleepImportError(
      'INVALID_SLEEP_TIMEZONE',
      'A supported IANA timezone is required for sleep summaries.',
    );
  }
}

export function localDayAt(
  epochMs: number,
  formatter: Intl.DateTimeFormat,
): string {
  const parts = new Map(
    formatter
      .formatToParts(new Date(epochMs))
      .map(part => [part.type, part.value]),
  );
  const year = parts.get('year');
  const month = parts.get('month');
  const day = parts.get('day');
  if (!year || !month || !day) {
    throw new SleepImportError(
      'INVALID_SLEEP_TIMEZONE',
      'The local calendar date could not be read.',
    );
  }
  return year.padStart(4, '0') + '-' + month + '-' + day;
}

export function dayOrdinal(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new SleepImportError(
      'INVALID_SLEEP_DAY_RANGE',
      'Sleep summary days must use YYYY-MM-DD calendar dates.',
    );
  }
  const date = new Date(value + 'T00:00:00.000Z');
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new SleepImportError(
      'INVALID_SLEEP_DAY_RANGE',
      'A sleep summary day is not a valid Gregorian date.',
    );
  }
  return Math.floor(date.getTime() / dayLengthMs);
}

export function dayFromOrdinal(ordinal: number): string {
  return new Date(ordinal * dayLengthMs).toISOString().slice(0, 10);
}
