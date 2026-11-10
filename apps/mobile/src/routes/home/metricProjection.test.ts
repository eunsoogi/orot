import { healthContextDays } from '../../healthEvidence/healthContext/window';
import type { HealthContextReport } from '../../healthEvidence/healthContext/types';
import { projectHomeMetric } from './metricProjection';

test('keeps gaps and excludes the partial day from coverage-aware comparisons', () => {
  const window = {
    fromInclusive: '2026-10-01T00:00:00Z',
    toExclusive: '2026-10-15T12:00:00Z',
    timeZone: 'UTC',
  };
  const day = (date: string, value: number) => ({
    date,
    samples: 1,
    minimum: value,
    maximum: value,
    mean: value,
    sum: value,
    latest: value,
    firstAt: `${date}T01:00:00Z`,
    lastAt: `${date}T01:00:00Z`,
  });
  const report: HealthContextReport = {
    window,
    days: healthContextDays(window),
    quantities: [
      {
        concept: 'heart_rate',
        unit: 'count/min',
        source: 'sensor',
        days: [
          day('2026-10-01', 60),
          day('2026-10-08', 100),
          day('2026-10-15', 200),
        ],
      },
    ],
    sleep: [],
    medications: [],
    symptoms: { entryCount: 0, recordedDays: 0, latest: [] },
    limitations: [],
    mutationGeneration: 0,
    deletionGeneration: 0,
  };
  const result = projectHomeMetric(report, 'heartRate', 'Watch');
  expect(result?.comparison).toMatchObject({
    previous: 60,
    recent: 100,
    previousCoverage: 1,
    recentCoverage: 1,
  });
  expect(result?.days).toHaveLength(7);
  expect(result?.days.at(-1)).toEqual({
    date: '2026-10-15',
    value: 200,
    partial: true,
  });
  expect(result?.days[0]?.value).toBeNull();
  expect(
    projectHomeMetric(
      { ...report, limitations: ['quantity_sensor_series_limit_reached'] },
      'heartRate',
      'Watch',
    )?.comparison,
  ).toBeNull();
});

test('includes a missing today slot even at local midnight', () => {
  const window = {
    fromInclusive: '2026-10-01T00:00:00Z',
    toExclusive: '2026-10-15T00:00:00Z',
    timeZone: 'UTC',
  };
  const report: HealthContextReport = {
    window,
    days: healthContextDays(window),
    quantities: [],
    sleep: [
      {
        date: '2026-10-14',
        asleepSeconds: 3600,
        stages: {},
        overlappingStageSeconds: 0,
        sampleCount: 1,
      },
    ],
    medications: [],
    symptoms: { entryCount: 0, recordedDays: 0, latest: [] },
    limitations: [],
    mutationGeneration: 0,
    deletionGeneration: 0,
  };
  const result = projectHomeMetric(report, 'sleep', 'Watch');
  expect(result?.days).toHaveLength(7);
  expect(result?.days.at(-1)).toEqual({
    date: '2026-10-15',
    value: null,
    partial: true,
  });
});

test('keeps one source series and separates latest body mass from the daily-mean comparison', () => {
  const window = {
    fromInclusive: '2026-09-30T15:00:00Z',
    toExclusive: '2026-10-15T03:00:00Z',
    timeZone: 'Asia/Seoul',
  };
  const dates = Array.from({ length: 14 }, (_, index) =>
    new Date(Date.UTC(2026, 9, index + 1)).toISOString().slice(0, 10),
  );
  const day = (date: string, value: number) => ({
    date,
    samples: 1,
    minimum: value,
    maximum: value,
    mean: value,
    sum: value,
    latest: value,
    firstAt: date + 'T03:00:00Z',
    lastAt: date + 'T03:00:00Z',
  });
  const report: HealthContextReport = {
    window,
    days: healthContextDays(window),
    quantities: [
      {
        concept: 'body_mass',
        unit: 'kg',
        source: 'watch-series',
        days: dates.map((date, index) => day(date, index === 13 ? 80 : 70)),
      },
      {
        concept: 'body_mass',
        unit: 'kg',
        source: 'phone-series',
        days: dates.map((date, index) => day(date, index === 13 ? 600 : 500)),
      },
    ],
    sleep: [],
    medications: [],
    symptoms: { entryCount: 0, recordedDays: 0, latest: [] },
    limitations: [],
    mutationGeneration: 0,
    deletionGeneration: 0,
  };

  const result = projectHomeMetric(report, 'bodyMass', 'Selected Watch');

  expect(result?.source).toBe('Selected Watch');
  expect(result?.timeZone).toBe('Asia/Seoul');
  expect(result?.latest).toEqual({ date: '2026-10-14', value: 80 });
  expect(result?.comparison?.previous).toBe(70);
  expect(result?.comparison?.recent).toBeCloseTo(71.428571, 5);
  expect(result?.days.at(-2)).toEqual({
    date: '2026-10-14',
    value: 80,
    partial: false,
  });
  expect(result?.days.at(-1)).toEqual({
    date: '2026-10-15',
    value: null,
    partial: true,
  });
});

test('keeps an actual zero separate from an unmeasured calendar day', () => {
  const window = {
    fromInclusive: '2026-09-30T15:00:00Z',
    toExclusive: '2026-10-15T03:00:00Z',
    timeZone: 'Asia/Seoul',
  };
  const report: HealthContextReport = {
    window,
    days: healthContextDays(window),
    quantities: [
      {
        concept: 'step_count',
        unit: 'count',
        source: 'watch-series',
        days: [
          {
            date: '2026-10-14',
            samples: 1,
            minimum: 0,
            maximum: 0,
            mean: 0,
            sum: 0,
            latest: 0,
            firstAt: '2026-10-14T03:00:00Z',
            lastAt: '2026-10-14T03:00:00Z',
          },
        ],
      },
    ],
    sleep: [],
    medications: [],
    symptoms: { entryCount: 0, recordedDays: 0, latest: [] },
    limitations: [],
    mutationGeneration: 0,
    deletionGeneration: 0,
  };

  const result = projectHomeMetric(report, 'steps', 'Selected Watch');

  expect(result?.days.at(-2)).toEqual({
    date: '2026-10-14',
    value: 0,
    partial: false,
  });
  expect(result?.days.at(-3)).toEqual({
    date: '2026-10-13',
    value: null,
    partial: false,
  });
});
