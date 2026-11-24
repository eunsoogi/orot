import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import {
  mapCommonObservationSample,
  toCommonObservationRecord,
} from '../../healthkit/commonObservations/mapper';
import { healthKitSample } from '../../healthkit/commonObservations/testSupport';
import { loadSelectedOverviewSnapshot } from './selectedOverviewSnapshot';
import {
  loadOverviewMetricSelection,
  saveOverviewMetricSelection,
} from './metricSelection';

const at = '2035-01-15T10:00:00.000Z';
const now = new Date('2035-01-15T20:00:00.000Z');
function imported(
  feature: 'restingHeartRate' | 'walkingHeartRateAverage',
  id: string,
  value: number,
  sourceIdentifier = 'synthetic.watch',
) {
  const mapped = mapCommonObservationSample(
    feature,
    healthKitSample(feature, {
      id,
      value,
      startDate: at,
      endDate: at,
      sourceIdentifier,
      sourceName: 'Synthetic watch',
    }),
  );
  if (mapped.status !== 'mapped') throw new Error('Fixture invalid');
  return toCommonObservationRecord(mapped.observation, at);
}

test('stored overview choices keep exact source, BPM and type without reading unselected derived metrics', async () => {
  const fixture = openSqliteTestDatabase(':memory:');
  try {
    const { database } = fixture;
    await runMigrations(database);
    const repository = createRecordRepository(database);
    const resting = imported('restingHeartRate', 'a', 56);
    const walking = imported('walkingHeartRateAverage', 'b', 102);
    for (const record of [
      { ...healthObservation('raw', 'heart_rate', at), ingestedAt: at },
      resting,
      imported('restingHeartRate', 'a2', 60),
      imported('restingHeartRate', 'secondary', 90, 'synthetic.phone'),
      walking,
      {
        ...resting,
        id: 'spoofed',
        value: { kind: 'quantity' as const, amount: 120, unit: 'count/min' },
      },
    ])
      await repository.put('health_observation', record);
    // Existing installation fallback remains the same; derived metrics are opt-in.
    expect(await loadOverviewMetricSelection(repository)).toEqual([
      'sleep',
      'heartRate',
    ]);
    const signal = new AbortController().signal;
    const { chart: defaultRead } = await loadSelectedOverviewSnapshot(
      database,
      now,
      signal,
    );
    expect(defaultRead.metrics.restingHeartRate).toBeUndefined();
    expect(defaultRead.metrics.walkingHeartRate).toBeUndefined();

    const selected = [
      'walkingHeartRate',
      'workoutHeartRate',
      'heartRate',
      'restingHeartRate',
    ] as const;
    await saveOverviewMetricSelection(repository, selected);
    const saved = await loadOverviewMetricSelection(repository);
    expect(saved).toEqual(selected);
    const { selection, chart } = await loadSelectedOverviewSnapshot(
      database,
      now,
      signal,
    );
    expect(selection).toEqual(selected);
    expect(chart.metrics).not.toHaveProperty('workoutHeartRate');
    expect(chart.metrics.restingHeartRate).toMatchObject({
      metric: 'restingHeartRate',
      unit: 'count/min',
      latest: { value: 58 },
      source: 'Synthetic watch',
      comparison: null,
    });
    expect(
      chart.metrics.restingHeartRate?.days.find(day => day.value === 58)?.range,
    ).toEqual({
      minimum: 56,
      maximum: 60,
      samples: 2,
    });
    expect(chart.metrics.walkingHeartRate?.latest.value).toBe(102);
    expect(
      chart.metrics.walkingHeartRate?.days.filter(day => day.value !== null),
    ).toHaveLength(1);
    await repository.delete('health_observation', walking.id);
    const { chart: deleted } = await loadSelectedOverviewSnapshot(
      database,
      now,
      signal,
    );
    expect(deleted.metrics.walkingHeartRate).toBeUndefined();
    expect(deleted.metrics.restingHeartRate?.latest.value).toBe(58);
  } finally {
    fixture.close();
  }
});

test('verified summaries count exact local-day quantities without borrowing midnight or overlapping extrema', async () => {
  const f = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(f.database);
    const repo = createRecordRepository(f.database);
    const feature = 'restingHeartRate' as const;
    const reportAt = new Date(2035, 0, 16, 20);
    const mk = (
      id: string,
      hour: number,
      endHour: number,
      bpm: number,
      summary?: {
        minimum: number;
        maximum: number;
        mean: number;
        count: number;
      },
    ) => {
      const startDate = new Date(2035, 0, 15, hour).toISOString();
      const endDate = new Date(2035, 0, 15, endHour).toISOString();
      const mapped = mapCommonObservationSample(
        feature,
        healthKitSample(feature, {
          id,
          value: bpm,
          startDate,
          endDate,
          ...(summary ? { heartRateSampleSummary: summary } : {}),
        }),
      );
      if (mapped.status !== 'mapped')
        throw new Error('Invalid synthetic source');
      return toCommonObservationRecord(mapped.observation, startDate);
    };
    const sample = { minimum: 50, maximum: 81, mean: 61.25, count: 4 };
    const exact = mk('one-container', 7, 8, 61.25, sample);
    const scalar = mk('one-scalar', 13, 13, 70);
    const crossing = mk('cross-midnight', 23, 24, 70, {
      minimum: 48,
      maximum: 99,
      mean: 70,
      count: 4,
    });
    for (const value of [exact, scalar, crossing])
      await repo.put('health_observation', value);
    await saveOverviewMetricSelection(repo, ['sleep', 'restingHeartRate']);
    const read = () =>
      loadSelectedOverviewSnapshot(
        f.database,
        reportAt,
        new AbortController().signal,
      );
    const result = await read();
    expect(result.chart.metrics.restingHeartRate?.latest.value).toBeCloseTo(
      385 / 6,
    );
    expect(result.chart.metrics.restingHeartRate?.days.at(-2)?.range).toEqual({
      minimum: 50,
      maximum: 81,
      samples: 6,
    });
    await repo.put('health_observation', mk('overlap', 8, 9, 68));
    const overlap = await read();
    expect(overlap.chart.metrics.restingHeartRate?.days.at(-2)?.range).toEqual({
      minimum: 61.25,
      maximum: 70,
      samples: 4,
    });
  } finally {
    f.close();
  }
});
