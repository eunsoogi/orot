import { validateHealthContextCalendar } from '../calendarValidation';
import { parseHealthContextScope } from '../scope';
import * as calendar from '../window';
import type { HealthContextWindow } from '../types';

function outcome(run: () => unknown) {
  try {
    run();
    return 'accepted';
  } catch (error) {
    return `${(error as Error).name}:${(error as Error).message}`;
  }
}
const base: HealthContextWindow = {
  fromInclusive: '2020-01-01T00:00:00Z',
  toExclusive: '2025-01-01T00:00:00Z',
  timeZone: 'UTC',
};
const scope = (window: HealthContextWindow) => ({
  kind: 'health_context_period',
  version: 1,
  topic: 'measurements',
  window,
});
afterEach(() => jest.restoreAllMocks());

// The unchanged enumerator is the acceptance oracle, including its edge failures.
test('matches cold and repeated validation across DST, skipped days and timestamp edges', () => {
  const pairs = [
    ['2024-03-09T12:00:00Z', '2024-03-12T00:00:00Z'],
    ['2024-11-02T12:00:00Z', '2024-11-05T00:00:00Z'],
    ['2011-12-29T00:00:00Z', '2012-01-01T00:00:00Z'],
    ['2026-01-01T00:00:00.0001Z', '2026-01-01T00:00:00.0002Z'],
    ['2026-01-01T00:00:00+09:00', '2026-01-02T00:00:00+09:00'],
    ['0001-01-01T00:00:00Z', '0001-01-02T00:00:00Z'],
    ['9998-12-30T00:00:00Z', '9998-12-31T00:00:00Z'],
    ['+275760-09-12T00:00:00Z', '+275760-09-13T00:00:00Z'],
    ['bad', '2026-01-02T00:00:00Z'],
    ['2026-01-02T00:00:00Z', '2026-01-01T00:00:00Z'],
  ];
  for (const timeZone of [
    'UTC',
    'Asia/Seoul',
    'America/New_York',
    'Pacific/Apia',
    'invalid-zone',
  ]) {
    for (const [fromInclusive, toExclusive] of pairs) {
      const window = { fromInclusive, toExclusive, timeZone };
      const expected = outcome(() => calendar.healthContextDays(window));
      expect(outcome(() => validateHealthContextCalendar(window))).toBe(
        expected,
      );
      expect(outcome(() => validateHealthContextCalendar({ ...window }))).toBe(
        expected,
      );
    }
  }
});

test('matches deterministic randomized partial calendar windows and cutoff admission', () => {
  let seed = 1931;
  for (let i = 0; i < 40; i += 1) {
    seed = (seed * 16807) % 2147483647;
    const start =
      Date.UTC(2000, 0, 1) + (seed % 9000) * 86400000 + (seed % 86400000);
    const to = start + (1 + (seed % 7)) * 86400000;
    const window = {
      fromInclusive: new Date(start).toISOString(),
      toExclusive: new Date(to).toISOString(),
      timeZone: ['America/New_York', 'Pacific/Apia', 'Australia/Lord_Howe'][
        i % 3
      ],
      dataAvailableThrough: new Date(to + (i % 2 ? 1 : -1)).toISOString(),
    };
    expect(outcome(() => validateHealthContextCalendar(window))).toBe(
      outcome(() => calendar.healthContextDays(window)),
    );
  }
});

test('does not trust mutable window identity or hide dose and shape validation on warm keys', () => {
  const input = { ...base };
  expect(parseHealthContextScope(scope(input))).toBeDefined();
  for (const change of [
    { timeZone: 'invalid-zone' },
    { fromInclusive: 'bad' },
    { toExclusive: base.fromInclusive },
    { dataAvailableThrough: '2024-01-01T00:00:00Z' },
  ]) {
    Object.assign(input, base, change);
    expect(parseHealthContextScope(scope(input))).toBeUndefined();
    delete input.dataAvailableThrough;
  }
  expect(
    parseHealthContextScope(
      scope({ ...base, doseHistory: { page: 0, pageSize: 0 } }),
    ),
  ).toBeUndefined();
  expect(
    parseHealthContextScope({ ...scope(base), topic: 'unknown' }),
  ).toBeUndefined();
  expect(parseHealthContextScope(scope(base))).toBeDefined();
});

test('reuses only successful primitive validation, never actual calendar arrays', () => {
  const input = { ...base, timeZone: 'Etc/UTC' };
  const spy = jest.spyOn(calendar, 'healthContextDays');
  for (let i = 0; i < 63; i += 1)
    expect(parseHealthContextScope(scope({ ...input }))).toBeDefined();
  expect(spy).toHaveBeenCalledTimes(1);
  const first = calendar.healthContextDays(input);
  first[0] = { ...first[0], date: 'changed-by-caller' };
  const second = calendar.healthContextDays(input);
  expect(second[0].date).toBe('2020-01-01');
  expect(spy).toHaveBeenCalledTimes(3);
  for (let i = 0; i < 2; i += 1)
    expect(() =>
      validateHealthContextCalendar({ ...input, timeZone: 'not-a-zone' }),
    ).toThrow();
  expect(spy).toHaveBeenCalledTimes(5);
});

test('eviction only recalculates and never rejects a valid period', () => {
  const input = { ...base, timeZone: 'Etc/GMT' };
  validateHealthContextCalendar(input);
  for (let i = 1; i <= 40; i += 1) {
    validateHealthContextCalendar({
      fromInclusive: new Date(Date.UTC(2025, 0, i)).toISOString(),
      toExclusive: new Date(Date.UTC(2025, 0, i + 1)).toISOString(),
      timeZone: 'UTC',
    });
  }
  const spy = jest.spyOn(calendar, 'healthContextDays');
  validateHealthContextCalendar(input);
  expect(spy).toHaveBeenCalledTimes(1);
});

test('nonstring runtime inputs cannot collide with successful primitive keys', () => {
  const input = { ...base, timeZone: 'UTC' };
  validateHealthContextCalendar(input);
  for (const changed of [
    { timeZone: undefined },
    { timeZone: null },
    { fromInclusive: 1577836800000 },
    { dataAvailableThrough: null },
  ]) {
    const malformed = {
      ...input,
      ...changed,
    } as unknown as HealthContextWindow;
    const expected = outcome(() => calendar.healthContextDays(malformed));
    const spy = jest.spyOn(calendar, 'healthContextDays');
    expect(outcome(() => validateHealthContextCalendar(malformed))).toBe(
      expected,
    );
    expect(outcome(() => validateHealthContextCalendar(malformed))).toBe(
      expected,
    );
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  }
});

test('recent successful reuse refreshes LRU position without retaining arrays', () => {
  const windows = Array.from({ length: 33 }, (_, index) => ({
    fromInclusive: new Date(Date.UTC(2031, 0, index + 1)).toISOString(),
    toExclusive: new Date(Date.UTC(2031, 0, index + 2)).toISOString(),
    timeZone: 'UTC',
  }));
  windows.slice(0, 32).forEach(validateHealthContextCalendar);
  validateHealthContextCalendar(windows[0]);
  validateHealthContextCalendar(windows[32]);
  const spy = jest.spyOn(calendar, 'healthContextDays');
  validateHealthContextCalendar(windows[0]);
  expect(spy).not.toHaveBeenCalled();
  validateHealthContextCalendar(windows[1]);
  expect(spy).toHaveBeenCalledTimes(1);
});
