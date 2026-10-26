import { runHealthKitAutoSync } from '../autoSync';
import { healthKitAutoSyncCheckpointKey } from '../autoSyncCheckpoint';
import { MemoryObservationRepository } from '../commonObservations/testSupport';
import {
  healthKit,
  observedAt,
  page,
} from '../commonObservations/testSyncSupport';
import { syncCommonObservationChanges } from '../commonObservations/sync';
import { syncHealthKitBloodPressure } from '../bloodPressure/sync';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => {
    resolve = accept;
  });
  return { promise, resolve };
}

describe('HealthKit automatic sync', () => {
  it('remembers a common-observation import request after authorization completes', async () => {
    const repository = new MemoryObservationRepository();
    const healthKitClient = {
      ...healthKit([]),
      querySampleChanges: jest.fn(async () => ({
        availability: 'unavailable' as const,
        status: 'notRun' as const,
        readAuthorization: 'notObservable' as const,
      })),
    };

    await syncCommonObservationChanges({
      feature: 'heartRate',
      healthKit: healthKitClient,
      repository,
      now: () => observedAt,
      rememberForAutoSync: true,
    });

    expect(
      await repository.getSyncCheckpoint(
        healthKitAutoSyncCheckpointKey('heartRate'),
      ),
    ).toMatchObject({ value: 'requested', updatedAt: observedAt });
  });

  it('remembers a blood-pressure import request after authorization completes', async () => {
    const repository = new MemoryObservationRepository();
    const healthKitClient = {
      ...healthKit([]),
      querySampleChanges: jest.fn(async () => ({
        availability: 'unavailable' as const,
        status: 'notRun' as const,
        readAuthorization: 'notObservable' as const,
      })),
    };

    await syncHealthKitBloodPressure({
      healthKit: healthKitClient,
      repository,
      now: () => observedAt,
      rememberForAutoSync: true,
    });

    expect(
      await repository.getSyncCheckpoint(
        healthKitAutoSyncCheckpointKey('bloodPressure'),
      ),
    ).toMatchObject({ value: 'requested', updatedAt: observedAt });
  });

  it('does not enable automatic common sync when authorization cannot run', async () => {
    const repository = new MemoryObservationRepository();
    const requestReadAuthorization = jest.fn(async () => ({
      availability: 'unavailable' as const,
      requestStatus: 'notRequested' as const,
      readAuthorization: 'notObservable' as const,
    }));
    const querySampleChanges = jest.fn();

    await syncCommonObservationChanges({
      feature: 'heartRate',
      healthKit: {
        ...healthKit([]),
        requestReadAuthorization,
        querySampleChanges,
      },
      repository,
      now: () => observedAt,
      rememberForAutoSync: true,
    });

    expect(requestReadAuthorization).toHaveBeenCalledTimes(1);
    expect(querySampleChanges).not.toHaveBeenCalled();
    expect(
      await repository.getSyncCheckpoint(
        healthKitAutoSyncCheckpointKey('heartRate'),
      ),
    ).toBeNull();
  });

  it('refreshes only previously selected features without requesting authorization again', async () => {
    const repository = new MemoryObservationRepository();
    await repository.transaction(async writer => {
      await writer.putSyncCheckpoint({
        key: healthKitAutoSyncCheckpointKey('heartRate'),
        value: 'requested',
        updatedAt: observedAt,
      });
      await writer.putSyncCheckpoint({
        key: healthKitAutoSyncCheckpointKey('bloodPressure'),
        value: 'requested',
        updatedAt: observedAt,
      });
    });
    const requestReadAuthorization = jest.fn();
    const querySampleChanges = jest
      .fn(healthKit([]).querySampleChanges)
      .mockResolvedValue(page({ cursor: 'next' }));
    const automaticHealthKit = {
      ...healthKit([]),
      requestReadAuthorization,
      querySampleChanges,
    };

    const result = await runHealthKitAutoSync({
      repository,
      healthKit: automaticHealthKit,
      now: () => observedAt,
    });

    expect(result).toEqual({
      status: 'complete',
      attemptedFeatures: ['heartRate', 'bloodPressure'],
    });
    expect(requestReadAuthorization).not.toHaveBeenCalled();
    expect(querySampleChanges).toHaveBeenCalledTimes(2);
    expect(
      querySampleChanges.mock.calls.map(([query]) => query.feature),
    ).toEqual(['heartRate', 'bloodPressure']);
  });

  it('does not query features that have no prior explicit import request', async () => {
    const requestReadAuthorization = jest.fn();
    const querySampleChanges = jest.fn(healthKit([]).querySampleChanges);
    const automaticHealthKit = {
      ...healthKit([]),
      requestReadAuthorization,
      querySampleChanges,
    };

    await expect(
      runHealthKitAutoSync({
        repository: new MemoryObservationRepository(),
        healthKit: automaticHealthKit,
        now: () => observedAt,
      }),
    ).resolves.toEqual({ status: 'skipped', attemptedFeatures: [] });

    expect(requestReadAuthorization).not.toHaveBeenCalled();
    expect(querySampleChanges).not.toHaveBeenCalled();
  });

  it('leaves a failed feature eligible for a later retry', async () => {
    const repository = new MemoryObservationRepository();
    await repository.transaction(writer =>
      writer.putSyncCheckpoint({
        key: healthKitAutoSyncCheckpointKey('heartRate'),
        value: 'requested',
        updatedAt: observedAt,
      }),
    );
    const querySampleChanges = jest
      .fn(healthKit([]).querySampleChanges)
      .mockResolvedValueOnce({
        availability: 'unavailable',
        status: 'notRun',
        readAuthorization: 'notObservable',
      })
      .mockResolvedValueOnce(page({ cursor: 'recovered' }));
    const options = {
      repository,
      healthKit: { ...healthKit([]), querySampleChanges },
      now: () => observedAt,
    };

    await expect(runHealthKitAutoSync(options)).resolves.toEqual({
      status: 'retryable',
      attemptedFeatures: ['heartRate'],
    });
    expect(
      await repository.getSyncCheckpoint(
        healthKitAutoSyncCheckpointKey('heartRate'),
      ),
    ).toMatchObject({ value: 'requested' });

    await expect(runHealthKitAutoSync(options)).resolves.toEqual({
      status: 'complete',
      attemptedFeatures: ['heartRate'],
    });
    expect(querySampleChanges).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ feature: 'heartRate', cursor: null }),
    );
  });

  it('coalesces overlapping automatic refreshes for the same repository', async () => {
    const repository = new MemoryObservationRepository();
    await repository.transaction(writer =>
      writer.putSyncCheckpoint({
        key: healthKitAutoSyncCheckpointKey('heartRate'),
        value: 'requested',
        updatedAt: observedAt,
      }),
    );
    const response = deferred<ReturnType<typeof page>>();
    const querySampleChanges = jest.fn(() => response.promise);
    const options = {
      repository,
      healthKit: { ...healthKit([]), querySampleChanges },
      now: () => observedAt,
    };

    const first = runHealthKitAutoSync(options);
    const overlapping = runHealthKitAutoSync(options);

    expect(overlapping).toBe(first);
    response.resolve(page({ cursor: 'next' }));
    await expect(first).resolves.toEqual({
      status: 'complete',
      attemptedFeatures: ['heartRate'],
    });
    expect(querySampleChanges).toHaveBeenCalledTimes(1);
  });
});
