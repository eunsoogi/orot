import { DailyReportLocalDateSchema, createDailyReportIdentity } from './dailyReportIdentity';

const dayMilliseconds = 86_400_000;

function dayFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function dateKey(formatter: Intl.DateTimeFormat, instant: number): string {
  const parts = formatter.formatToParts(new Date(instant));
  const part = (type: string) => parts.find((value) => value.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * dayMilliseconds)
    .toISOString()
    .slice(0, 10);
}

/** Binary-search local midnight without treating a civil day as a fixed duration. */
function dayStart(date: string, formatter: Intl.DateTimeFormat): number {
  const nominal = Date.parse(`${date}T00:00:00Z`);
  let low = nominal - 36 * 3_600_000;
  let high = nominal + 36 * 3_600_000;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (dateKey(formatter, middle) < date) low = middle + 1;
    else high = middle;
  }
  return low;
}

export interface DailyReportCalendarInterval {
  readonly fromInclusive: string;
  readonly toExclusive: string;
}

/** Return exact bounds for an existing civil day; skipped timezone dates have no interval. */
export function dailyReportCalendarInterval(
  localDate: string,
  timeZone: string,
): DailyReportCalendarInterval | undefined {
  const parsedDate = DailyReportLocalDateSchema.safeParse(localDate);
  if (!parsedDate.success) return undefined;

  let identity: ReturnType<typeof createDailyReportIdentity>;
  try {
    identity = createDailyReportIdentity(parsedDate.data, timeZone);
  } catch {
    return undefined;
  }

  const formatter = dayFormatter(identity.timeZone);
  const start = dayStart(identity.localDate, formatter);
  if (dateKey(formatter, start) !== identity.localDate) return undefined;

  const end = dayStart(shiftDate(identity.localDate, 1), formatter);
  if (end <= start) return undefined;
  return {
    fromInclusive: new Date(start).toISOString(),
    toExclusive: new Date(end).toISOString(),
  };
}
