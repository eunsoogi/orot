import { healthContextDays, recentHealthContextWindow } from '../window';

test('uses local occurrence dates and preserves short/long DST days', () => {
  const days = healthContextDays({
    fromInclusive: '2026-03-07T05:00:00Z',
    toExclusive: '2026-03-10T04:00:00Z',
    timeZone: 'America/New_York',
  });
  expect(days.map(day => day.date)).toEqual([
    '2026-03-07',
    '2026-03-08',
    '2026-03-09',
  ]);
  expect(
    days.map(
      day =>
        (Date.parse(day.toExclusive) - Date.parse(day.fromInclusive)) /
        3_600_000,
    ),
  ).toEqual([24, 23, 24]);
  expect(days.every(day => !day.partial)).toBe(true);
});

test('counts thirty calendar days including a partial today, or thirty completed days at midnight', () => {
  const partial = recentHealthContextWindow(
    30,
    '2026-10-20T03:00:00Z',
    'Asia/Seoul',
  );
  const days = healthContextDays(partial);
  expect(days).toHaveLength(30);
  expect(days[0]?.date).toBe('2026-09-21');
  expect(days.at(-1)).toMatchObject({ date: '2026-10-20', partial: true });
  const completed = healthContextDays(
    recentHealthContextWindow(30, '2026-10-19T15:00:00Z', 'Asia/Seoul'),
  );
  expect(completed).toHaveLength(30);
  expect(completed.at(-1)).toMatchObject({
    date: '2026-10-19',
    partial: false,
  });
});

test('rejects invalid zones, reversed windows and unbounded history', () => {
  expect(() =>
    healthContextDays({
      fromInclusive: '2026-01-01T00:00:00Z',
      toExclusive: '2027-01-01T00:00:00Z',
      timeZone: 'UTC',
    }),
  ).toThrow();
  expect(() =>
    recentHealthContextWindow(7, '2026-10-20T00:00:00Z', 'invalid/zone'),
  ).toThrow();
});

test('retains exact sub-millisecond endpoints and includes the partial day just after midnight', () => {
  const window = {
    fromInclusive: '2026-10-01T00:00:00.0005Z',
    toExclusive: '2026-10-02T00:00:00.0005Z',
    timeZone: 'UTC',
  };
  expect(healthContextDays(window)).toEqual([
    {
      date: '2026-10-01',
      fromInclusive: window.fromInclusive,
      toExclusive: '2026-10-02T00:00:00.000Z',
      partial: true,
    },
    {
      date: '2026-10-02',
      fromInclusive: '2026-10-02T00:00:00.000Z',
      toExclusive: window.toExclusive,
      partial: true,
    },
  ]);
  const recent = healthContextDays(
    recentHealthContextWindow(7, window.toExclusive, 'UTC'),
  );
  expect(recent).toHaveLength(7);
  expect(recent.at(-1)).toMatchObject({
    date: '2026-10-02',
    partial: true,
    toExclusive: window.toExclusive,
  });
});

test('accepts a nonempty exact period within one millisecond', () => {
  const window = {
    fromInclusive: '2026-10-01T00:00:00.0001Z',
    toExclusive: '2026-10-01T00:00:00.0009Z',
    timeZone: 'UTC',
  };
  expect(healthContextDays(window)).toEqual(
    [{ date: '2026-10-01', ...window, partial: true }].map(
      ({ timeZone: _zone, ...day }) => day,
    ),
  );
});
