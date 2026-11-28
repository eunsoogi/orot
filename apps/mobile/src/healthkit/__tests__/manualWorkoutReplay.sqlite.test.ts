import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { runPreviouslyRequestedHealthKit } from '../autoSync';
import { saveHealthKitAutoSyncSelection } from '../autoSyncCheckpoint';
import { healthKitSampleChangesCheckpointKey } from '../sampleChangesCheckpoint';
import { healthKitSample } from '../commonObservations/testSupport';
import { observedAt, page } from '../commonObservations/testSyncSupport';
import type { HealthKitNativeModule } from '../types';

const mockQuery = jest.fn<
  ReturnType<HealthKitNativeModule['querySampleChanges']>,
  Parameters<HealthKitNativeModule['querySampleChanges']>
>();
test('a manual refresh recovers an already-visible pre-anchor third-party workout without asking for permission', async () => {
  const f = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(f.database);
    const repository = createRecordRepository(f.database);
    const run = (mode: 'automatic' | 'manual') =>
      runPreviouslyRequestedHealthKit(
        {
          repository,
          healthKit: { querySampleChanges: mockQuery },
          now: () => observedAt,
        },
        mode,
      );
    await saveHealthKitAutoSyncSelection(
      repository,
      ['workouts'],
      () => observedAt,
    );
    const key = healthKitSampleChangesCheckpointKey('workouts', 'workouts');
    await repository.transaction(writer =>
      writer.putSyncCheckpoint({
        key,
        value: 'existing-anchor',
        updatedAt: observedAt,
      }),
    );
    const partner = healthKitSample('workouts', {
      id: '22334455-6677-4222-8222-222222222222',
      sourceIdentifier: 'example.synthetic.workout',
      sourceName: 'Synthetic third-party workout',
      workoutActivityType: 37,
      workoutActivityName: 'running',
      value: 18,
      unit: 'min',
    });
    mockQuery.mockImplementation(async ({ cursor }) =>
      cursor
        ? page({ cursor })
        : page({ cursor: 'new-anchor', addedSamples: [partner] }),
    );

    await run('automatic');
    expect(mockQuery.mock.calls.map(([request]) => request.cursor)).toEqual([
      'existing-anchor',
    ]);
    expect(await repository.list('health_observation')).toHaveLength(0);

    await run('manual');
    const records = await repository.list('health_observation');
    expect(records).toContainEqual(
      expect.objectContaining({
        id: 'healthkit:workouts:' + partner.id,
        effectiveAt: partner.startDate,
        value: expect.objectContaining({ amount: 18, unit: 'min' }),
      }),
    );
    expect(JSON.stringify(records)).toContain('example.synthetic.workout');
    expect(mockQuery.mock.calls.map(([request]) => request.cursor)).toEqual([
      'existing-anchor',
      null,
    ]);

    await run('automatic');
    expect(mockQuery.mock.calls.at(-1)?.[0].cursor).toBe('new-anchor');
    expect(await repository.list('health_observation')).toHaveLength(1);
  } finally {
    f.close();
  }
});
