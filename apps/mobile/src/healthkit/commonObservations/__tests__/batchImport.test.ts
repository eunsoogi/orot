import type {
  HealthKitBatchAuthorizationResult,
  HealthKitFeature,
  HealthKitNativeModule,
  HealthKitSampleChangesResult,
} from '../../types';
import { importCommonObservations } from '../importer';
import { healthKitSample, MemoryObservationRepository } from '../testSupport';

function page(
  values: Partial<
    Extract<HealthKitSampleChangesResult, { status: 'completed' }>
  > = {},
): HealthKitSampleChangesResult {
  return {
    availability: 'available',
    status: 'completed',
    readAuthorization: 'notObservable',
    addedSamples: [],
    deletedSampleIds: [],
    cursor: null,
    hasMore: false,
    ...values,
  };
}

function healthKit(
  pages: HealthKitSampleChangesResult[],
): Pick<
  HealthKitNativeModule,
  'requestReadAuthorizations' | 'querySampleChanges'
> {
  return {
    requestReadAuthorizations: jest
      .fn()
      .mockImplementation(async (features: readonly HealthKitFeature[]) => {
        const unsupportedFeatures = features.filter(
          feature => feature === 'bodyMass',
        );
        const requestedFeatures = features.filter(
          feature => feature !== 'bodyMass',
        );
        if (requestedFeatures.length === 0) {
          return {
            availability: 'unsupportedFeature',
            requestStatus: 'notRequested',
            readAuthorization: 'notObservable',
            requestedFeatures: [],
            unsupportedFeatures,
          };
        }
        return {
          availability: 'available',
          requestStatus: 'completed',
          readAuthorization: 'notObservable',
          requestedFeatures,
          unsupportedFeatures,
        };
      }),
    querySampleChanges: jest.fn().mockImplementation(async () => {
      const next = pages.shift();
      if (!next) throw new Error('Unexpected HealthKit page request.');
      return next;
    }),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => {
    resolve = accept;
  });
  return { promise, resolve };
}

describe('batched common observation imports', () => {
  it('requests selected features once before queries or repository writes', async () => {
    const repository = new MemoryObservationRepository();
    const health = healthKit([
      page({
        addedSamples: [healthKitSample('heartRate')],
        cursor: 'heart-rate-anchor',
      }),
    ]);
    const authorization = deferred<HealthKitBatchAuthorizationResult>();
    const authorizationStarted = deferred<void>();
    const requestReadAuthorizations = jest.fn(() => {
      authorizationStarted.resolve();
      return authorization.promise;
    });
    Object.assign(health, { requestReadAuthorizations });
    const transaction = jest.spyOn(repository, 'transaction');

    const importing = importCommonObservations({
      features: ['heartRate', 'bodyMass'],
      healthKit: health,
      repository,
      now: () => '2026-10-05T10:00:00.000Z',
    });
    await authorizationStarted.promise;

    expect(requestReadAuthorizations).toHaveBeenCalledTimes(1);
    expect(requestReadAuthorizations).toHaveBeenCalledWith([
      'heartRate',
      'bodyMass',
    ]);
    expect(health.querySampleChanges).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();

    authorization.resolve({
      availability: 'available',
      requestStatus: 'completed',
      readAuthorization: 'notObservable',
      requestedFeatures: ['heartRate'],
      unsupportedFeatures: ['bodyMass'],
    });
    await expect(importing).resolves.toMatchObject({
      status: 'partial',
      importedCount: 1,
      readAuthorization: 'notObservable',
    });
    expect(health.querySampleChanges).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('skips permission and data access when the selection is empty', async () => {
    const repository = new MemoryObservationRepository();
    const health = healthKit([]);
    await expect(
      importCommonObservations({
        features: [],
        healthKit: health,
        repository,
        now: () => '2026-10-05T10:00:00.000Z',
      }),
    ).resolves.toMatchObject({ status: 'empty', importedCount: 0 });
    expect(health.requestReadAuthorizations).not.toHaveBeenCalled();
    expect(health.querySampleChanges).not.toHaveBeenCalled();
  });

  it('coalesces repeat imports and retries after a failed authorization', async () => {
    const repository = new MemoryObservationRepository();
    const authorization = deferred<HealthKitBatchAuthorizationResult>();
    const health = healthKit([
      page({
        addedSamples: [healthKitSample('heartRate')],
        cursor: 'heart-rate-anchor',
      }),
    ]);
    const requestReadAuthorizations = jest
      .fn()
      .mockReturnValueOnce(Promise.reject(new Error('request failed')))
      .mockReturnValueOnce(authorization.promise);
    Object.assign(health, { requestReadAuthorizations });

    await expect(
      importCommonObservations({
        features: ['heartRate'],
        healthKit: health,
        repository,
        now: () => '2026-10-05T10:00:00.000Z',
      }),
    ).rejects.toThrow('request failed');
    expect(health.querySampleChanges).not.toHaveBeenCalled();
    expect(repository.transactionsCommitted).toBe(0);

    const retry = importCommonObservations({
      features: ['heartRate'],
      healthKit: health,
      repository,
      now: () => '2026-10-05T10:00:00.000Z',
    });
    const overlappingRetry = importCommonObservations({
      features: ['heartRate'],
      healthKit: health,
      repository,
      now: () => '2026-10-05T10:00:00.000Z',
    });
    await Promise.resolve();
    expect(requestReadAuthorizations).toHaveBeenCalledTimes(2);
    expect(health.querySampleChanges).not.toHaveBeenCalled();

    authorization.resolve({
      availability: 'available',
      requestStatus: 'completed',
      readAuthorization: 'notObservable',
      requestedFeatures: ['heartRate'],
      unsupportedFeatures: [],
    });
    await expect(retry).resolves.toMatchObject({ status: 'complete' });
    await expect(overlappingRetry).resolves.toMatchObject({
      status: 'complete',
    });
    expect(health.querySampleChanges).toHaveBeenCalledTimes(1);
    expect(repository.transactionsCommitted).toBe(1);
  });
});
