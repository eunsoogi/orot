import { createRecordRepository, runMigrations } from '@orot/storage';
import { healthObservation } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { createHealthEvidenceTestDatabase } from '../../localEvidenceTestSupport';
import { createHealthContextReader } from '../reader';

/** Equal-time ordering and nested intervals must agree with the independent half-open overlap definition. */
test('the sweep matches overlap rules for nested workouts and heart intervals spanning several workouts', async () => {
  const f = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(f.database);
    const records = createRecordRepository(f.database);
    const iso = (minute: number) =>
      new Date(Date.UTC(2026, 9, 1) + minute * 60000).toISOString();
    const workouts = [
      [10, 100],
      [20, 30],
      [110, 120],
      [110, 115],
      [150, 160],
    ];
    const hearts = [
      [9, 10],
      [10, 10],
      [40, 41],
      [100, 100],
      [100, 110],
      [100, 111],
      [110, 110],
      [109, 151],
      [160, 160],
      [0, 200],
    ];
    for (const [index, [start, end]] of workouts.entries()) {
      await records.put('health_observation', {
        ...healthObservation(
          `workout-${index}`,
          'workout_duration',
          iso(start!),
          'healthkit',
          'imported',
          iso(end!),
        ),
        value: { kind: 'quantity', amount: end! - start!, unit: 'min' },
      });
    }
    for (const [index, [start, end]] of hearts.entries()) {
      // One synthetic sensor per sample makes each classification observable without exposing raw IDs.
      const record = healthObservation(
        `heart-${index}`,
        'heart_rate',
        iso(start!),
        'healthkit',
        'imported',
        iso(end!),
      );
      await records.put('health_observation', {
        ...record,
        provenance: {
          ...record.provenance,
          source: {
            system: 'healthkit',
            sourceIdentifier: `synthetic-${index}`,
          },
        },
      });
    }
    const report = await createHealthContextReader(f.database)(
      { fromInclusive: iso(0), toExclusive: iso(1440), timeZone: 'UTC' },
      ['measurements'],
    );
    for (const [index, [start, end]] of hearts.entries()) {
      const overlap = workouts.some(([a, b]) =>
        start === end ? start! >= a! && start! < b! : start! < b! && end! > a!,
      );
      expect(
        report.quantities.find(item => item.source === `synthetic-${index}:`)
          ?.days[0]?.activityContext,
      ).toEqual([
        {
          context: overlap ? 'workout_overlap' : 'no_recorded_workout_overlap',
          samples: 1,
          minimum: 72,
          maximum: 72,
        },
      ]);
    }
  } finally {
    f.close();
  }
});
