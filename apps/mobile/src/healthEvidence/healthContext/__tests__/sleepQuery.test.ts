import { createRecordRepository, runMigrations } from '@orot/storage';
import { healthObservation } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { createHealthEvidenceTestDatabase } from '../../localEvidenceTestSupport';
import { readHealthSleepContext } from '../sleepQuery';
import { healthContextDays } from '../window';

test('unions duplicate/overlapping stages, excluding awake time from sleep duration', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    const records = createRecordRepository(database);
    for (const [id, start, end, code] of [
      ['core', '22:00', '23:00', '3'],
      ['duplicate-core', '22:00', '23:00', '3'],
      ['deep', '22:30', '23:30', '4'],
      ['awake', '23:30', '23:40', '2'],
    ]) {
      await records.put('health_observation', {
        ...healthObservation(
          id!,
          'HKCategoryTypeIdentifierSleepAnalysis',
          `2026-10-01T${start}:00Z`,
          'healthkit',
          'imported',
          `2026-10-01T${end}:00Z`,
        ),
        value: { kind: 'text', text: code! },
      });
    }
    const result = await readHealthSleepContext(
      database,
      healthContextDays({
        fromInclusive: '2026-10-01T00:00:00Z',
        toExclusive: '2026-10-02T00:00:00Z',
        timeZone: 'UTC',
      }),
    );
    expect(result.unsupportedCategories).toBe(false);
    expect(result.days[0]).toMatchObject({
      asleepSeconds: 5400,
      sampleCount: 4,
      overlappingStageSeconds: 1800,
      stages: { asleepCore: 3600, asleepDeep: 3600, awake: 600 },
    });
  } finally {
    close();
  }
});

test('clips cross-midnight intervals into local days without converting an unknown code to sleep', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    const records = createRecordRepository(database);
    await records.put('health_observation', {
      ...healthObservation(
        'cross',
        'HKCategoryTypeIdentifierSleepAnalysis',
        '2026-10-01T23:30:00Z',
        'healthkit',
        'imported',
        '2026-10-02T00:30:00Z',
      ),
      value: { kind: 'text', text: '3' },
    });
    await records.put('health_observation', {
      ...healthObservation(
        'unknown',
        'HKCategoryTypeIdentifierSleepAnalysis',
        '2026-10-01T20:00:00Z',
        'healthkit',
        'imported',
        '2026-10-01T21:00:00Z',
      ),
      value: { kind: 'text', text: '999' },
    });
    const result = await readHealthSleepContext(
      database,
      healthContextDays({
        fromInclusive: '2026-10-01T00:00:00Z',
        toExclusive: '2026-10-03T00:00:00Z',
        timeZone: 'UTC',
      }),
    );
    expect(result.unsupportedCategories).toBe(true);
    expect(result.days.map(day => day.asleepSeconds)).toEqual([1800, 1800]);
  } finally {
    close();
  }
});
