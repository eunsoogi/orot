import { mapHealthKitSleepSample } from '../mapper';
import { summarizeSleepByDay } from '../summary';
import { healthKitSleepSample } from '../testFixtures';

describe('sleep daily summaries', () => {
  it('unions in-bed intervals and partitions overlapping sleep stages deterministically', () => {
    const samples = [
      healthKitSleepSample({
        id: 'in-bed',
        categoryValue: 0,
        startDate: '2026-10-01T21:00:00Z',
        endDate: '2026-10-02T00:00:00Z',
      }),
      healthKitSleepSample({
        id: 'in-bed-overlap',
        categoryValue: 0,
        startDate: '2026-10-01T21:30:00Z',
        endDate: '2026-10-01T22:30:00Z',
      }),
      healthKitSleepSample({
        id: 'core-a',
        categoryValue: 3,
        startDate: '2026-10-01T22:00:00Z',
        endDate: '2026-10-01T23:00:00Z',
        sourceIdentifier: 'source-a',
      }),
      healthKitSleepSample({
        id: 'core-b',
        categoryValue: 3,
        startDate: '2026-10-01T22:00:00Z',
        endDate: '2026-10-01T23:00:00Z',
        sourceIdentifier: 'source-b',
      }),
      healthKitSleepSample({
        id: 'deep',
        categoryValue: 4,
        startDate: '2026-10-01T22:30:00Z',
        endDate: '2026-10-01T23:30:00Z',
      }),
      healthKitSleepSample({
        id: 'awake',
        categoryValue: 2,
        startDate: '2026-10-01T22:45:00Z',
        endDate: '2026-10-01T23:00:00Z',
      }),
    ].map(mapHealthKitSleepSample);

    const first = summarizeSleepByDay(samples, {
      fromDay: '2026-10-01',
      throughDay: '2026-10-01',
      timeZone: 'UTC',
    })[0];
    const reversed = summarizeSleepByDay([...samples].reverse(), {
      fromDay: '2026-10-01',
      throughDay: '2026-10-01',
      timeZone: 'UTC',
    })[0];

    expect(first).toMatchObject({
      status: 'observed',
      sampleCount: 6,
      inBedDurationMs: 3 * 60 * 60 * 1000,
      asleepDurationMs: 75 * 60 * 1000,
      awakeDurationMs: 15 * 60 * 1000,
      stageDurationMs: {
        asleepUnspecified: 0,
        asleepCore: 30 * 60 * 1000,
        asleepDeep: 45 * 60 * 1000,
        asleepREM: 0,
      },
    });
    expect(reversed).toEqual(first);
  });

  it('splits an overnight interval at local midnight in the requested timezone', () => {
    const sample = mapHealthKitSleepSample(
      healthKitSleepSample({
        startDate: '2026-10-03T06:30:00Z',
        endDate: '2026-10-03T08:30:00Z',
      }),
    );

    const summaries = summarizeSleepByDay([sample], {
      fromDay: '2026-10-02',
      throughDay: '2026-10-03',
      timeZone: 'America/Los_Angeles',
    });

    expect(summaries.map(item => item.asleepDurationMs)).toEqual([
      30 * 60 * 1000,
      90 * 60 * 1000,
    ]);
  });

  it('counts elapsed time correctly across spring-forward and fall-back days', () => {
    const spring = mapHealthKitSleepSample(
      healthKitSleepSample({
        id: 'spring',
        startDate: '2026-03-08T08:30:00Z',
        endDate: '2026-03-08T10:30:00Z',
      }),
    );
    const fall = mapHealthKitSleepSample(
      healthKitSleepSample({
        id: 'fall',
        startDate: '2026-11-01T07:30:00Z',
        endDate: '2026-11-01T10:30:00Z',
      }),
    );

    const springSummary = summarizeSleepByDay([spring], {
      fromDay: '2026-03-08',
      throughDay: '2026-03-08',
      timeZone: 'America/Los_Angeles',
    })[0];
    const fallSummary = summarizeSleepByDay([fall], {
      fromDay: '2026-11-01',
      throughDay: '2026-11-01',
      timeZone: 'America/Los_Angeles',
    })[0];

    expect(springSummary?.asleepDurationMs).toBe(2 * 60 * 60 * 1000);
    expect(fallSummary?.asleepDurationMs).toBe(3 * 60 * 60 * 1000);
  });

  it('preserves no-data days and marks unsupported-only observations as observed', () => {
    const known = mapHealthKitSleepSample(
      healthKitSleepSample({
        id: 'known',
        startDate: '2026-10-01T22:00:00Z',
        endDate: '2026-10-01T23:00:00Z',
      }),
    );
    const unknown = mapHealthKitSleepSample(
      healthKitSleepSample({
        id: 'unknown',
        categoryValue: 99,
        startDate: '2026-10-03T22:00:00Z',
        endDate: '2026-10-03T23:00:00Z',
      }),
    );

    const summaries = summarizeSleepByDay([known, unknown], {
      fromDay: '2026-10-01',
      throughDay: '2026-10-03',
      timeZone: 'UTC',
    });

    expect(summaries.map(item => item.status)).toEqual([
      'observed',
      'noData',
      'observed',
    ]);
    expect(summaries[1]?.asleepDurationMs).toBe(0);
    expect(summaries[2]?.unclassifiedDurationMs).toBe(60 * 60 * 1000);
  });

  it('rejects invalid date ranges and timezones rather than using the machine timezone', () => {
    expect(() =>
      summarizeSleepByDay([], {
        fromDay: '2026-02-30',
        throughDay: '2026-03-01',
        timeZone: 'UTC',
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_SLEEP_DAY_RANGE' }));
    expect(() =>
      summarizeSleepByDay([], {
        fromDay: '2026-10-01',
        throughDay: '2026-10-01',
        timeZone: 'Mars/Olympus',
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_SLEEP_TIMEZONE' }));
  });
});
