import type { HealthKitSampleChangesResult } from '../../types';
import { healthKitSampleChangesCheckpointKey } from '../../sampleChangesCheckpoint';
import { syncCommonObservationChanges } from '../sync';
import { healthKitSample, MemoryObservationRepository } from '../testSupport';
import { healthKit, observedAt, page } from '../testSyncSupport';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => {
    resolve = accept;
  });
  return { promise, resolve };
}

describe('common observation import concurrency', () => {
  it('waits for an older page before applying a reopened import deletion', async () => {
    const repository = new MemoryObservationRepository();
    const firstPage = deferred<HealthKitSampleChangesResult>();
    const firstPageStarted = deferred<void>();
    const olderHealth = {
      ...healthKit([]),
      querySampleChanges: jest.fn(async () => {
        firstPageStarted.resolve();
        return firstPage.promise;
      }),
    };
    const olderImport = syncCommonObservationChanges({
      feature: 'heartRate',
      healthKit: olderHealth,
      repository,
      now: () => observedAt,
    });

    await firstPageStarted.promise;
    const reopenedHealth = healthKit([
      page({ deletedSampleIds: ['sample-1'], cursor: 'a2' }),
    ]);
    const reopenedImport = syncCommonObservationChanges({
      feature: 'heartRate',
      healthKit: reopenedHealth,
      repository,
      now: () => observedAt,
    });

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(reopenedHealth.querySampleChanges).not.toHaveBeenCalled();

    firstPage.resolve(
      page({
        addedSamples: [healthKitSample('heartRate')],
        cursor: 'a1',
      }),
    );
    await expect(olderImport).resolves.toMatchObject({
      status: 'complete',
      upserted: 1,
    });
    await expect(reopenedImport).resolves.toMatchObject({
      status: 'complete',
      deleted: 1,
    });

    expect(reopenedHealth.querySampleChanges).toHaveBeenCalledWith({
      feature: 'heartRate',
      sampleKind: 'heartRate',
      limit: 200,
      cursor: 'a1',
    });
    expect(repository.read('healthkit:heartRate:sample-1')).toBeNull();
    expect(
      await repository.getSyncCheckpoint(
        healthKitSampleChangesCheckpointKey('heartRate', 'heartRate'),
      ),
    ).toMatchObject({ value: 'a2' });
  });
});
