import {
  civilDateTime,
  dateKey,
  dayFormatter,
  dayStart,
  shiftDate,
} from '../calendarDate';
import { observeCalendarProbes } from '../testSupport/observeCalendarProbes';

test('reuses civil boundaries across topics without repeated Intl work', () => {
  const formatter = dayFormatter('Asia/Tokyo');
  const probes = observeCalendarProbes(formatter);
  const boundaries = Array.from({ length: 91 }, (_, n) =>
    dayStart(shiftDate('2025-07-01', n), formatter),
  );
  const coldCalls = probes.count;
  for (let topic = 0; topic < 5; topic++) {
    const reused = dayFormatter('Asia/Tokyo');
    expect(reused).toBe(formatter);
    boundaries.forEach((boundary, n) => {
      expect(dayStart(shiftDate('2025-07-01', n), reused)).toBe(boundary);
    });
  }
  expect(coldCalls).toBeGreaterThan(91);
  expect(probes.count).toBe(coldCalls);
  probes.dispose();
});

test('bounds retained zones and dates and isolates civil timezones', () => {
  const first = dayFormatter('Pacific/Honolulu');
  const probes = observeCalendarProbes(first);
  const original = dayStart('2025-01-01', first);
  for (let n = 1; n <= 4096; n++) dayStart(shiftDate('2025-01-01', n), first);
  probes.reset();
  expect(dayStart('2025-01-01', first)).toBe(original);
  expect(probes.count).toBeGreaterThan(0);
  probes.dispose();
  for (const zone of ['UTC', 'Asia/Seoul', 'Europe/London', 'America/New_York'])
    dayFormatter(zone);
  expect(dayFormatter('Pacific/Honolulu')).not.toBe(first);
  expect(dayStart('2025-01-01', dayFormatter('UTC'))).not.toBe(original);
});

test.each([
  ['Africa/Monrovia', '1972-01-07'],
  ['Pacific/Apia', '2011-12-30'],
  ['America/St_Johns', '1987-10-25'],
  ['Pacific/Honolulu', '0000-01-01'],
])('preserves the millisecond search for %s on %s', (zone, date) => {
  const formatter = dayFormatter(zone);
  const nominal = civilDateTime(date);
  const utc = new Date(nominal);
  const target =
    utc.getUTCFullYear() * 10000 +
    (utc.getUTCMonth() + 1) * 100 +
    utc.getUTCDate();
  let low = nominal - 36 * 3_600_000;
  let high = nominal + 36 * 3_600_000;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    const parts = Object.fromEntries(
      formatter.formatToParts(middle).map(({ type, value }) => [type, value]),
    );
    const year =
      parts.era === 'BC' ? 1 - Number(parts.year) : Number(parts.year);
    const current =
      year * 10000 + Number(parts.month) * 100 + Number(parts.day);
    if (current < target) low = middle + 1;
    else high = middle;
  }
  expect(dayStart(date, formatter)).toBe(low);
});

test('still uses structured fields for an unrecognized formatted date', () => {
  const formatter = dayFormatter('Asia/Seoul');
  Object.defineProperty(formatter, 'format', {
    value: () => '2025년 4월 19일',
    configurable: true,
  });
  try {
    expect(dateKey(formatter, Date.UTC(2025, 3, 18, 15))).toBe('2025-04-19');
  } finally {
    Reflect.deleteProperty(formatter, 'format');
  }
});
