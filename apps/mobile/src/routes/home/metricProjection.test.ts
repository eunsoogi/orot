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
