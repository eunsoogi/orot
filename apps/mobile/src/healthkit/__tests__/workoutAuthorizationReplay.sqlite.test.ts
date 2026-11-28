import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { configureHealthKitAutoSync } from '../autoSyncSettings';
import { runHealthKitAutoSync } from '../autoSync';
import { healthKitSampleChangesCheckpointKey } from '../sampleChangesCheckpoint';
import { healthKitSample } from '../commonObservations/testSupport';
import { observedAt, page } from '../commonObservations/testSyncSupport';
import type { HealthKitNativeModule } from '../types';

const key = healthKitSampleChangesCheckpointKey('workouts', 'workouts');
const source = 'example.synthetic.workout';
const partner = healthKitSample('workouts', {
  id: '22222222-2222-4222-8222-222222222222',
  sourceIdentifier: source,
  sourceName: 'Synthetic workout partner',
  value: 42,
  unit: 'min',
  workoutActivityType: 50,
  workoutActivityName: 'strength',
});
const apple = {
  ...partner,
  id: '11111111-1111-4111-8111-111111111111',
  sourceIdentifier: 'com.apple.Health',
  sourceName: 'Synthetic Apple source',
};

test('explicit workout authorization recovers a newly visible pre-anchor partner record, and launch stays incremental', async () => {
  const f = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(f.database);
    const repository = createRecordRepository(f.database);
    const authorize = jest
      .fn<
        ReturnType<HealthKitNativeModule['requestReadAuthorizations']>,
        Parameters<HealthKitNativeModule['requestReadAuthorizations']>
      >()
      .mockResolvedValue({
        availability: 'available',
        requestStatus: 'completed',
        readAuthorization: 'notObservable',
        requestedFeatures: ['workouts'],
        unsupportedFeatures: [],
      });
    const query = jest.fn<
      ReturnType<HealthKitNativeModule['querySampleChanges']>,
      Parameters<HealthKitNativeModule['querySampleChanges']>
    >(async ({ cursor }) => {
      if (!cursor && authorize.mock.calls.length === 1)
        return page({ addedSamples: [apple], cursor: 'restricted-anchor' });
      if (!cursor)
        return page({
          addedSamples: [apple, partner],
          cursor: 'current-anchor',
        });
      if (cursor === 'restricted-anchor') return page({ cursor });
      return page({ deletedSampleIds: [apple.id], cursor: 'next-anchor' });
    });
    const options = {
      repository,
      healthKit: {
        requestReadAuthorizations: authorize,
        querySampleChanges: query,
      },
      now: () => observedAt,
    };

    await expect(
      configureHealthKitAutoSync(['workouts'], options),
    ).resolves.toMatchObject({ status: 'complete' });
    expect(await repository.getSyncCheckpoint(key)).toMatchObject({
      value: 'restricted-anchor',
    });
    expect(await repository.list('health_observation')).toHaveLength(1);

    await expect(
      configureHealthKitAutoSync(['workouts'], options),
    ).resolves.toMatchObject({ status: 'complete' });
    expect(query.mock.calls[1]?.[0]).toEqual({
      feature: 'workouts',
      sampleKind: 'workouts',
      limit: 200,
      cursor: null,
    });
    const records = await repository.list('health_observation');
    expect(records).toHaveLength(2);
    expect(
      records.find(record =>
        record.provenance.sourceRecordIds.includes(partner.id),
      ),
    ).toMatchObject({
      effectiveAt: partner.startDate,
      endedAt: partner.endDate,
      value: { amount: 42, unit: 'min' },
      provenance: { source: { sourceIdentifier: source } },
    });

    await expect(runHealthKitAutoSync(options)).resolves.toMatchObject({
      status: 'complete',
    });
    expect(query.mock.calls[2]?.[0].cursor).toBe('current-anchor');
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(await repository.list('health_observation')).toHaveLength(1);
    expect(await repository.getSyncCheckpoint(key)).toMatchObject({
      value: 'next-anchor',
    });
  } finally {
    f.close();
  }
});

test('an interrupted workout replay leaves the previously committed incremental cursor available', async () => {
  const f = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(f.database);
    const repository = createRecordRepository(f.database);
    const authorize: HealthKitNativeModule['requestReadAuthorizations'] =
      async () => ({
        availability: 'available',
        requestStatus: 'completed',
        readAuthorization: 'notObservable',
        requestedFeatures: ['workouts'],
        unsupportedFeatures: [],
      });
    const query = jest
      .fn<
        ReturnType<HealthKitNativeModule['querySampleChanges']>,
        Parameters<HealthKitNativeModule['querySampleChanges']>
      >()
      .mockResolvedValueOnce(
        page({ addedSamples: [apple], cursor: 'saved-anchor' }),
      )
      .mockResolvedValueOnce(
        page({ addedSamples: [partner], cursor: 'replay-page', hasMore: true }),
      )
      .mockResolvedValueOnce({
        availability: 'unavailable',
        status: 'notRun',
        readAuthorization: 'notObservable',
      })
      .mockResolvedValueOnce(
        page({ deletedSampleIds: [apple.id], cursor: 'resumed-anchor' }),
      );
    const options = {
      repository,
      healthKit: {
        requestReadAuthorizations: authorize,
        querySampleChanges: query,
      },
      now: () => observedAt,
    };

    await expect(
      configureHealthKitAutoSync(['workouts'], options),
    ).resolves.toMatchObject({ status: 'complete' });
    await expect(
      configureHealthKitAutoSync(['workouts'], options),
    ).resolves.toMatchObject({ status: 'retryable' });
    expect(await repository.getSyncCheckpoint(key)).toMatchObject({
      value: 'saved-anchor',
    });
    await expect(runHealthKitAutoSync(options)).resolves.toMatchObject({
      status: 'complete',
    });
    expect(query.mock.calls.map(([request]) => request.cursor)).toEqual([
      null,
      null,
      'replay-page',
      'saved-anchor',
    ]);
    expect(await repository.list('health_observation')).toEqual([
      expect.objectContaining({
        provenance: expect.objectContaining({ sourceRecordIds: [partner.id] }),
      }),
    ]);
    expect(await repository.getSyncCheckpoint(key)).toMatchObject({
      value: 'resumed-anchor',
    });
  } finally {
    f.close();
  }
});
