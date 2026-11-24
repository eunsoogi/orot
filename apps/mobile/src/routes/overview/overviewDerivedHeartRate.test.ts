import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import {
  mapCommonObservationSample,
  toCommonObservationRecord,
} from '../../healthkit/commonObservations/mapper';
import { healthKitSample } from '../../healthkit/commonObservations/testSupport';
import { loadOverviewMetrics } from './metricLoader';
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
    const defaultRead = await loadOverviewMetrics(database, now);
    expect(defaultRead.metrics.restingHeartRate).toBeUndefined();
    expect(defaultRead.metrics.walkingHeartRate).toBeUndefined();

    const selected = [
      'walkingHeartRate',
      'heartRate',
      'restingHeartRate',
    ] as const;
    await saveOverviewMetricSelection(repository, selected);
    const saved = await loadOverviewMetricSelection(repository);
    expect(saved).toEqual(selected);
    const chart = await loadOverviewMetrics(database, now, undefined, saved);
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
    const deleted = await loadOverviewMetrics(database, now, undefined, saved);
    expect(deleted.metrics.walkingHeartRate).toBeUndefined();
    expect(deleted.metrics.restingHeartRate?.latest.value).toBe(58);
  } finally {
    fixture.close();
  }
});
