import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { runHealthKitAutoSync } from '../../autoSync';
import {
  healthKitAutoSyncCheckpointKey,
  rememberHealthKitAutoSyncRequest,
} from '../../autoSyncCheckpoint';
import { commonObservationRecordId } from '../mapper';
import { syncCommonObservationChanges } from '../sync';
import { healthKitSample } from '../testSupport';
import { healthKit, page } from '../testSyncSupport';

const feature = 'restingHeartRate' as const;
const summary = { count: 4, minimum: 50, maximum: 81, mean: 61.25 };
function sample(id: string, includeSummary: boolean) {
  return healthKitSample(feature, {
    id,
    value: summary.mean,
    startDate: new Date(2035, 0, 14, 10).toISOString(),
    endDate: new Date(2035, 0, 14, 11).toISOString(),
    ...(includeSummary ? { heartRateSampleSummary: summary } : {}),
  });
}

test('zero matches, capped reads, and mixed provenance stay retryable without rapid rescans', async () => {
  const f = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(f.database);
    const repository = createRecordRepository(f.database);
    let day = 15;
    const now = () => new Date(2035, 0, day, 20).toISOString();
    const cursor = 'old-anchor';
    await syncCommonObservationChanges({
      feature,
      repository,
      healthKit: healthKit([
        page({
          addedSamples: [sample('known', false), sample('conflicted', false)],
          cursor,
        }),
      ]),
      now,
    });
    await rememberHealthKitAutoSyncRequest(repository, feature, now);
    const wire = healthKit(Array.from({ length: 6 }, () => page({ cursor })));
    let samples = [sample('unknown', true)];
    const querySamples = jest.fn(async () => ({
      availability: 'available' as const,
      status: 'completed' as const,
      readAuthorization: 'notObservable' as const,
      samples,
    }));
    const options = { repository, now, healthKit: { ...wire, querySamples } };
    const sync = () => runHealthKitAutoSync(options);
    const read = () =>
      repository.get(
        'health_observation',
        commonObservationRecordId(feature, 'known'),
      );
    await sync();
    await sync();
    expect(querySamples).toHaveBeenCalledTimes(1);
    expect((await read())?.heartRateSampleSummary).toBeUndefined();

    day += 1;
    samples = [
      sample('known', true),
      ...Array.from({ length: 499 }, (_, i) => sample('unknown-' + i, true)),
    ];
    await sync();
    expect(querySamples).toHaveBeenCalledTimes(2);
    expect((await read())?.heartRateSampleSummary).toEqual(summary);

    day += 1;
    samples = [
      sample('known', true),
      { ...sample('conflicted', true), sourceProductType: 'OtherWatch' },
    ];
    await sync();
    expect(querySamples).toHaveBeenCalledTimes(3);

    await sync();
    expect(querySamples).toHaveBeenCalledTimes(3);
    const conflicting = () =>
      repository.get(
        'health_observation',
        commonObservationRecordId(feature, 'conflicted'),
      );
    expect((await conflicting())?.heartRateSampleSummary).toBeUndefined();
    day += 1;
    samples = [sample('known', true), sample('conflicted', true)];
    await sync();
    expect(querySamples).toHaveBeenCalledTimes(4);
    expect((await conflicting())?.heartRateSampleSummary).toEqual(summary);
    expect(wire.requestReadAuthorization).not.toHaveBeenCalled();
    expect(await repository.list('health_observation')).toHaveLength(2);
  } finally {
    f.close();
  }
});

test('queued enrichment fails closed after the durable feature choice changes', async () => {
  const f = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(f.database);
    const repository = createRecordRepository(f.database);
    const now = () => new Date(2035, 0, 15, 20).toISOString();
    const cursor = 'old-anchor';
    await syncCommonObservationChanges({
      feature,
      repository,
      healthKit: healthKit([
        page({ addedSamples: [sample('known', false)], cursor }),
      ]),
      now,
    });
    await rememberHealthKitAutoSyncRequest(repository, feature, now);
    let waiting = false;
    let release!: () => void;
    let queued!: () => void;
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    const entered = new Promise<void>(resolve => {
      queued = resolve;
    });
    const queuedRepository: typeof repository = {
      ...repository,
      async transaction<T>(
        operation: Parameters<typeof repository.transaction<T>>[0],
      ) {
        if (waiting) {
          waiting = false;
          queued();
          await held;
        }
        return repository.transaction(operation);
      },
    };
    const wire = healthKit([page({ cursor })]);
    const querySamples = jest.fn(async () => {
      waiting = true;
      return {
        availability: 'available' as const,
        status: 'completed' as const,
        readAuthorization: 'notObservable' as const,
        samples: [sample('known', true)],
      };
    });
    const pending = runHealthKitAutoSync({
      repository: queuedRepository,
      now,
      healthKit: { ...wire, querySamples },
    });
    await entered;
    try {
      await repository.putSyncCheckpoint({
        key: healthKitAutoSyncCheckpointKey(feature),
        value: 'disabled',
        updatedAt: new Date(2035, 0, 15, 20, 1).toISOString(),
      });
    } finally {
      release();
    }
    await pending;
    expect(querySamples).toHaveBeenCalledTimes(1);
    expect(
      (
        await repository.get(
          'health_observation',
          commonObservationRecordId(feature, 'known'),
        )
      )?.heartRateSampleSummary,
    ).toBeUndefined();
    expect(
      await repository.getSyncCheckpoint(
        'healthkit:derived-discrete-inspection:v1:' + feature,
      ),
    ).toBeNull();
  } finally {
    f.close();
  }
});
