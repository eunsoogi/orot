import { createRecordRepository, runMigrations } from '@orot/storage';
import { healthObservation } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { createHealthEvidenceTestDatabase } from '../../localEvidenceTestSupport';
import { readHealthQuantityContext } from '../quantityQuery';
import { readHealthSleepContext } from '../sleepQuery';
import { healthContextDays } from '../window';

test('aggregates typed measurements beyond UI presets without reclassifying a diagnosis as sensor data', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    const repository = createRecordRepository(database);
    for (const [index, amount] of [90, 110].entries())
      await repository.put('health_observation', {
        ...healthObservation(
          `glucose-${index}`,
          'blood_glucose',
          `2026-10-01T0${index}:00:00Z`,
        ),
        value: { kind: 'quantity', amount, unit: 'mg/dL' },
      });
    await repository.put('health_observation', {
      ...healthObservation(
        'temperature',
        'temperature',
        '2026-10-01T00:00:00Z',
      ),
      value: { kind: 'quantity', amount: 36.5, unit: 'C' },
    });
    await repository.put('health_observation', {
      ...healthObservation(
        'diagnosis',
        'diagnostic-code',
        '2026-10-01T00:00:00Z',
      ),
      observationKind: 'diagnosis',
      value: { kind: 'quantity', amount: 123, unit: 'code' },
    });
    // An activity-like name cannot override the record's narrative clinical kind.
    for (const concept of ['step_count', 'workout_duration'])
      await repository.put('health_observation', {
        ...healthObservation(
          `clinical-${concept}`,
          concept,
          '2026-10-01T00:00:00Z',
        ),
        observationKind: 'diagnosis',
        value: { kind: 'quantity', amount: 123, unit: 'code' },
      });
    await repository.put('health_observation', {
      ...healthObservation(
        'clinical-sleep',
        'sleep',
        '2026-10-01T00:00:00Z',
        'healthkit',
        'imported',
        '2026-10-01T08:00:00Z',
      ),
      observationKind: 'diagnosis',
      value: { kind: 'text', text: 'asleepCore' },
    });
    const days = healthContextDays({
      fromInclusive: '2026-10-01T00:00:00Z',
      toExclusive: '2026-10-02T00:00:00Z',
      timeZone: 'UTC',
    });
    const result = await readHealthQuantityContext(
      database,
      days,
      undefined,
      'measurements',
    );
    expect(result.series.map(series => series.concept).sort()).toEqual([
      'blood_glucose',
      'temperature',
    ]);
    expect(
      result.series.find(series => series.concept === 'blood_glucose')?.days[0],
    ).toMatchObject({ samples: 2, minimum: 90, maximum: 110, mean: 100 });
    expect(result.truncated).toBe(false);
    expect((await readHealthSleepContext(database, days)).days).toEqual([]);
    expect(
      (await readHealthQuantityContext(database, days, undefined, 'activity'))
        .series,
    ).toEqual([]);
  } finally {
    close();
  }
});
