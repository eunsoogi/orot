import { projectHealthContext } from '../projection';
import { healthContextDays } from '../window';
import type { HealthContextReport } from '../types';

const window = {
  fromInclusive: '2026-10-01T00:00:00Z',
  toExclusive: '2026-10-15T12:00:00Z',
  timeZone: 'UTC',
};
const report: HealthContextReport = {
  window,
  days: healthContextDays(window),
  quantities: [
    {
      concept: 'heart_rate',
      unit: 'count/min',
      source: 'private-sensor-identity',
      days: [
        {
          date: '2026-10-01',
          samples: 100,
          minimum: 60,
          maximum: 60,
          mean: 60,
          sum: 6000,
          latest: 60,
          firstAt: '2026-10-01T00:00:00Z',
          lastAt: '2026-10-01T01:00:00Z',
        },
        {
          date: '2026-10-08',
          samples: 1,
          minimum: 100,
          maximum: 100,
          mean: 100,
          sum: 100,
          latest: 100,
          firstAt: '2026-10-08T00:00:00Z',
          lastAt: '2026-10-08T00:00:00Z',
        },
        {
          date: '2026-10-15',
          samples: 1,
          minimum: 200,
          maximum: 200,
          mean: 200,
          sum: 200,
          latest: 200,
          firstAt: '2026-10-15T00:00:00Z',
          lastAt: '2026-10-15T00:00:00Z',
        },
      ],
    },
  ],
  medications: [],
  sleep: [],
  symptoms: { entryCount: 0, recordedDays: 0, latest: [] },
  limitations: [],
  mutationGeneration: 123,
  deletionGeneration: 45,
};

test('uses equal daily weighting and coverage-aware comparisons excluding a partial today', () => {
  const projection = projectHealthContext(report);
  expect(projection.quantities[0]).toMatchObject({
    sampleCount: 102,
    recordedDays: 3,
    missingCalendarDays: 12,
    meanOfRecordedDailyMeans: 120,
    comparison: {
      previousMean: 60,
      recentMean: 100,
      difference: 40,
      previousRecordedDays: 1,
      recentRecordedDays: 1,
    },
  });
  const content = JSON.stringify(projection);
  expect(content).not.toContain('private-sensor-identity');
  expect(content).not.toContain('mutationGeneration');
  expect(content).not.toContain('deletionGeneration');
  expect(content).not.toContain('"days":');
  expect(
    projectHealthContext(report, 'daily').quantities[0]?.days,
  ).toHaveLength(3);
});

test('unknown or awake-only samples never become zero-sleep days in a duration mean', () => {
  const projection = projectHealthContext({
    ...report,
    sleep: [
      {
        date: '2026-10-01',
        asleepSeconds: 0,
        sampleCount: 1,
        stages: { unsupported: 600 },
        overlappingStageSeconds: 0,
      },
      {
        date: '2026-10-02',
        asleepSeconds: 3600,
        sampleCount: 1,
        stages: { asleepCore: 3600 },
        overlappingStageSeconds: 0,
      },
    ],
  });
  expect(projection.sleep).toMatchObject({
    recordedDays: 1,
    meanRecordedDailyMinutes: 60,
  });
});
