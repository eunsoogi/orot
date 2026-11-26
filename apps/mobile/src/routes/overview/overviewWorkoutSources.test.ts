import { createRecordRepository, runMigrations } from '@orot/storage';
import { openOpSqliteFileQueue } from '../../../test-support/opSqliteFileQueueFixture';
import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import { loadOverviewMetrics } from './metricLoader';

test('the Workout card follows the newest imported source rather than the most frequent one', async () => {
  const fixture = openOpSqliteFileQueue();
  try {
    await runMigrations(fixture.database);
    const repo = createRecordRepository(fixture.database);
    const entries = [
      ['watch-1', '2026-01-12T12:00:00Z', 'com.example.watch', 'Watch', 40],
      ['watch-2', '2026-01-13T12:00:00Z', 'com.example.watch', 'Watch', 48],
      ['watch-3', '2026-01-14T12:00:00Z', 'com.example.watch', 'Watch', 49],
      [
        'partner',
        '2026-01-14T17:00:00Z',
        'com.example.training',
        'Training',
        34,
      ],
    ] as const;
    for (const [id, at, sourceIdentifier, sourceName, amount] of entries) {
      const sample = healthObservation(id, 'workout_duration', at);
      await repo.put('health_observation', {
        ...sample,
        provenance: {
          ...sample.provenance,
          source: { system: 'healthkit', sourceIdentifier, sourceName },
        },
        value: { kind: 'quantity', amount, unit: 'min' },
      });
    }

    const { metrics } = await loadOverviewMetrics(
      fixture.database,
      new Date('2026-01-15T12:00:00Z'),
    );
    expect(metrics.workouts).toMatchObject({
      source: 'Training',
      measuredAt: '2026-01-14T17:00:00Z',
      latest: { date: '2026-01-14', value: 34 },
    });
    expect(
      metrics.workouts?.days.find(day => day.date === '2026-01-14'),
    ).toMatchObject({ value: 34 });
  } finally {
    fixture.close();
  }
});
