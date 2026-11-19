import {
  createHealthContextCalendarScope,
  readHealthContextCalendar,
} from '../calendarReadScope';
import * as calendar from '../window';
import { dayFormatter } from '../calendarDate';
import {
  committedReportCalendar,
  createCommittedReportScope,
} from '../committedReportScope';
import type { SqlDatabase } from '@orot/storage';

const window = {
  fromInclusive: '2024-03-10T06:59:59.99995Z',
  toExclusive: '2024-03-11T04:00:00.0001Z',
  timeZone: 'America/New_York',
  dataAvailableThrough: '2024-03-12T00:00:00Z',
};

test('reuses exact civil calendars while isolating returned arrays, mutable windows and cutoff keys', () => {
  const scope = createHealthContextCalendarScope();
  const expected = calendar.healthContextDays(window);
  const calculate = jest.spyOn(calendar, 'healthContextDays');
  try {
    const first = scope.read(window);
    (first[0]! as { fromInclusive: string }).fromInclusive = 'corrupted';
    first.pop();
    expect(scope.read({ ...window })).toEqual(expected);
    expect(
      scope.read({
        dataAvailableThrough: window.dataAvailableThrough,
        timeZone: window.timeZone,
        toExclusive: window.toExclusive,
        fromInclusive: window.fromInclusive,
      }),
    ).toEqual(expected);
    expect(calculate).toHaveBeenCalledTimes(1);
    scope.read({ ...window, dataAvailableThrough: '2024-03-13T00:00:00Z' });
    scope.read({ ...window, doseHistory: { page: 0, pageSize: 10 } });
    scope.read({ ...window, doseHistory: { page: 1, pageSize: 10 } });
    expect(calculate).toHaveBeenCalledTimes(4);
    const mutable = { ...window };
    mutable.toExclusive = '2024-03-11T04:00:00.0002Z';
    expect(scope.read(mutable).at(-1)!.toExclusive).toBe(mutable.toExclusive);
    expect(calculate).toHaveBeenCalledTimes(5);
  } finally {
    scope.dispose();
    calculate.mockRestore();
  }
});

test('validates every hit and never accepts invalid cutoff, timezone or reversed/fractional windows', () => {
  const scope = createHealthContextCalendarScope();
  try {
    scope.read(window);
    for (const invalid of [
      { ...window, dataAvailableThrough: '2024-03-11T04:00:00Z' },
      { ...window, dataAvailableThrough: 'invalid' },
      { ...window, timeZone: 'not/a-zone' },
      { ...window, fromInclusive: window.toExclusive },
      { ...window, fromInclusive: '2024-03-11T04:00:00.0002Z' },
    ])
      expect(() => scope.read(invalid)).toThrow();
    for (const zone of ['UTC', 'Pacific/Apia', 'America/New_York']) {
      const input = {
        fromInclusive: '2011-12-29T00:00:00Z',
        toExclusive: '2012-01-01T00:00:00Z',
        timeZone: zone,
      };
      expect(scope.read(input)).toEqual(calendar.healthContextDays(input));
    }
  } finally {
    scope.dispose();
  }
});

test('disposal clears reuse and foreign calendar wrappers retain strict calculation', () => {
  const scope = createHealthContextCalendarScope();
  const calculate = jest.spyOn(calendar, 'healthContextDays');
  try {
    const first = scope.read(window);
    scope.dispose();
    expect(scope.read(window)).toEqual(first);
    expect(scope.read(window)).toEqual(first);
    const foreign = { read: jest.fn(() => []), dispose: jest.fn() };
    expect(readHealthContextCalendar(foreign, window)).toEqual(first);
    expect(foreign.read).not.toHaveBeenCalled();
    expect(calculate).toHaveBeenCalledTimes(4);
  } finally {
    scope.dispose();
    calculate.mockRestore();
  }
});

test('committed calendar ownership is exact database identity and ends with its owner', () => {
  const database = {} as SqlDatabase;
  const owner = createCommittedReportScope(database);
  const scope = committedReportCalendar(owner.token, database)!;
  expect(
    committedReportCalendar(owner.token, {} as SqlDatabase),
  ).toBeUndefined();
  expect(
    committedReportCalendar({ kind: 'committed_report_scope' }, database),
  ).toBeUndefined();
  const calculate = jest.spyOn(calendar, 'healthContextDays');
  try {
    const first = scope.read(window);
    owner.dispose();
    expect(committedReportCalendar(owner.token, database)).toBeUndefined();
    expect(scope.read(window)).toEqual(first);
    expect(calculate).toHaveBeenCalledTimes(2);
  } finally {
    owner.dispose();
    calculate.mockRestore();
  }
});

test('a failed calendar enumeration never publishes an entry', () => {
  const scope = createHealthContextCalendarScope();
  const calculate = jest.spyOn(calendar, 'healthContextDays');
  try {
    calculate.mockImplementationOnce(() => {
      throw new RangeError('synthetic enumeration failure');
    });
    expect(() => scope.read(window)).toThrow('synthetic enumeration failure');
    const valid = scope.read(window);
    expect(scope.read(window)).toEqual(valid);
    expect(calculate).toHaveBeenCalledTimes(2);
  } finally {
    scope.dispose();
    calculate.mockRestore();
  }
});

test('overlapping long windows reuse civil midnights while retaining distinct clipped edges', () => {
  const scope = createHealthContextCalendarScope();
  const first = {
    fromInclusive: '2023-01-01T06:00:00.0001Z',
    toExclusive: '2024-04-01T04:00:00Z',
    timeZone: 'America/New_York',
  };
  const next = {
    ...first,
    fromInclusive: '2023-01-01T07:00:00.0002Z',
    toExclusive: '2024-04-02T04:00:00.0001Z',
  };
  const expected = calendar.healthContextDays(next);
  // Evict the expected-value formatter before measuring a cold first pass.
  for (const zone of ['UTC', 'Asia/Seoul', 'Pacific/Apia', 'Europe/London'])
    dayFormatter(zone);
  const format = jest.spyOn(dayFormatter(first.timeZone), 'formatToParts');
  try {
    // A decoded period enumerates the same civil boundaries before scoped reads.
    calendar.healthContextDays(first);
    expect(format.mock.calls.length).toBeGreaterThan(100);
    format.mockClear();
    expect(scope.read(next)).toEqual(expected);
    // Across the DST transitions only newly exposed boundaries need an Intl search.
    expect(format.mock.calls.length).toBeLessThan(100);
  } finally {
    scope.dispose();
    format.mockRestore();
  }
});
