import { createRecordRepository, runMigrations } from '@orot/storage';
import { healthObservation } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { createHealthEvidenceTestDatabase } from '../../localEvidenceTestSupport';
import { readHealthSleepContext } from '../sleepQuery';
import { healthContextContent } from '../../../aiFeatures/integration/healthContextEvidence';
import { createHealthContextReader } from '../reader';
import { healthSleepAwakeConflict } from '../observationSemantics';
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

test('stock scoped evidence emits recorded union once, and never invents an empty or disputed duration', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    const records = createRecordRepository(database);
    const window = {
      fromInclusive: '2026-10-01T00:00:00Z',
      toExclusive: '2026-10-03T00:00:00Z',
      timeZone: 'UTC',
    };
    const scope = {
      kind: 'health_context_period',
      version: 1,
      topic: 'sleep',
      window,
    } as const;
    const readContext = createHealthContextReader(database);
    const read = async () => {
      const report = await readContext(window, ['sleep']);
      return JSON.parse(
        healthContextContent(scope, report).slice('health_context: '.length),
      );
    };
    const put = (id: string, from: string, to: string, text: string) =>
      records.put('health_observation', {
        ...healthObservation(
          id,
          'HKCategoryTypeIdentifierSleepAnalysis',
          from,
          'healthkit',
          'imported',
          to,
        ),
        ingestedAt: '2026-10-02T12:00:00Z',
        value: { kind: 'text', text },
      });
    expect((await read()).sleep).toMatchObject({
      recordedDays: 0,
      meanRecordedDailyMinutes: null,
    });
    expect((await read()).sleep).not.toHaveProperty('observedAsleepSeconds');

    await put('asleep', '2026-10-01T23:30:00Z', '2026-10-02T00:30:00Z', '3');
    await put('stage', '2026-10-02T00:15:00Z', '2026-10-02T00:45:00Z', '4');
    await put(
      'awake-adjacent',
      '2026-10-02T00:45:00Z',
      '2026-10-02T01:00:00Z',
      '2',
    );
    await put('in-bed', '2026-10-01T22:00:00Z', '2026-10-02T01:30:00Z', '0');
    const recorded = await read();
    expect(recorded.sleep).toMatchObject({
      recordedDays: 2,
      observedAsleepSeconds: 4500,
      meanRecordedDailyMinutes: 37.5,
    });
    expect(recorded.limitations).not.toContain(healthSleepAwakeConflict);
    await put(
      'awake-crossing',
      '2026-10-02T00:30:00Z',
      '2026-10-02T01:00:00Z',
      '2',
    );
    const disputed = await read();
    expect(disputed.limitations).toContain(healthSleepAwakeConflict);
    expect(disputed.sleep).not.toHaveProperty('observedAsleepSeconds');
    expect(disputed.sleep.stageMinutes.awake).toBe(30);
  } finally {
    close();
  }
});
