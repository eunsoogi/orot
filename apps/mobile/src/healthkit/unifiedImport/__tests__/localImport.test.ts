import type { RecordRepository } from '@orot/storage';
import type {
  HealthKitAuthorizationResult,
  HealthKitNativeModule,
  HealthKitSampleChangesResult,
} from '../../types';
import {
  createMemoryBloodPressureRepository,
  correlation,
} from '../../bloodPressure/testSupport';
import {
  healthKitSample,
  MemoryObservationRepository,
} from '../../commonObservations/testSupport';
import { page } from '../../commonObservations/testSyncSupport';
import { healthKitSampleChangesCheckpointKey } from '../../sampleChangesCheckpoint';
import { healthKitAutoSyncCheckpointKey } from '../../autoSyncCheckpoint';
import { createUnifiedFeatureImporter } from '../featureImporter';
import { deferred } from '../testSupport';

const authorization: HealthKitAuthorizationResult = {
  availability: 'available',
  requestStatus: 'completed',
  readAuthorization: 'notObservable',
};

test('routes preauthorized blood pressure through measured query and atomic persistence', async () => {
  const store = createMemoryBloodPressureRepository();
  const phases: string[] = [];
  const healthKit = {
    queryMedicationDefinitions: jest.fn(),
    querySampleChanges: jest.fn().mockResolvedValue({
      availability: 'available',
      status: 'completed',
      readAuthorization: 'notObservable',
      addedSamples: [correlation()],
      deletedSampleIds: [],
      cursor: 'new-cursor',
      hasMore: false,
    }),
  } as unknown as Pick<
    HealthKitNativeModule,
    'querySampleChanges' | 'queryMedicationDefinitions'
  >;
  const importer = createUnifiedFeatureImporter({
    healthKit,
    now: () => '2026-10-07T00:00:00.000Z',
  });

  const outcome = await importer(
    'bloodPressure',
    authorization,
    store.repository as unknown as RecordRepository,
    {
      async query(operation) {
        phases.push('query:started');
        const result = await operation();
        phases.push('query:finished');
        return result;
      },
      async persist(operation) {
        phases.push('persistence:started');
        const result = await operation();
        phases.push('persistence:finished');
        return result;
      },
    },
  );

  expect(outcome).toEqual({
    status: 'complete',
    importedCount: 2,
    deletedCount: 0,
  });
  expect(healthKit.querySampleChanges).toHaveBeenCalledTimes(1);
  expect(phases).toEqual([
    'persistence:started',
    'persistence:finished',
    'query:started',
    'query:finished',
    'persistence:started',
    'persistence:finished',
  ]);
  expect(store.observations()).toHaveLength(2);
  expect(store.checkpoint('healthkit:bloodPressure:bloodPressure')?.value).toBe(
    'new-cursor',
  );
  expect(
    store.checkpoint(healthKitAutoSyncCheckpointKey('bloodPressure'))?.value,
  ).toBe('requested');
});

test('serializes overlapping adapter imports by the original repository identity', async () => {
  const store = new MemoryObservationRepository();
  const firstPage = deferred<HealthKitSampleChangesResult>();
  const firstQueryStarted = deferred<void>();
  let requestCount = 0;
  const querySampleChanges = jest.fn(
    async (
      _query: Parameters<HealthKitNativeModule['querySampleChanges']>[0],
    ) => {
      requestCount += 1;
      if (requestCount === 1) {
        firstQueryStarted.resolve(undefined);
        return firstPage.promise;
      }
      return page({ deletedSampleIds: ['sample-1'], cursor: 'a2' });
    },
  );
  const importer = createUnifiedFeatureImporter({
    healthKit: {
      querySampleChanges,
      queryMedicationDefinitions: jest.fn(),
    },
    now: () => '2026-10-07T00:00:00.000Z',
  });
  const repository = store as unknown as RecordRepository;
  const phases: string[] = [];
  const instrumentation = {
    async query<T>(operation: () => Promise<T>) {
      phases.push('query:started');
      const result = await operation();
      phases.push('query:finished');
      return result;
    },
    async persist<T>(operation: () => Promise<T>) {
      phases.push('persistence:started');
      const result = await operation();
      phases.push('persistence:finished');
      return result;
    },
  };

  // Phase hooks must keep the repository object used for the reopened-import lock.
  const olderImport = importer(
    'heartRate',
    authorization,
    repository,
    instrumentation,
  );
  await firstQueryStarted.promise;
  const reopenedImport = importer(
    'heartRate',
    authorization,
    repository,
    instrumentation,
  );
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(querySampleChanges).toHaveBeenCalledTimes(1);

  firstPage.resolve(
    page({
      addedSamples: [healthKitSample('heartRate')],
      cursor: 'a1',
    }),
  );
  await expect(olderImport).resolves.toMatchObject({
    status: 'complete',
    importedCount: 1,
  });
  await expect(reopenedImport).resolves.toMatchObject({
    status: 'complete',
    deletedCount: 1,
  });

  expect(querySampleChanges).toHaveBeenCalledTimes(2);
  expect(phases).toEqual([
    'persistence:started',
    'persistence:finished',
    'query:started',
    'query:finished',
    'persistence:started',
    'persistence:finished',
    'persistence:started',
    'persistence:finished',
    'query:started',
    'query:finished',
    'persistence:started',
    'persistence:finished',
  ]);
  expect(querySampleChanges.mock.calls[1][0].cursor).toBe('a1');
  expect(store.read('healthkit:heartRate:sample-1')).toBeNull();
  await expect(
    store.getSyncCheckpoint(
      healthKitSampleChangesCheckpointKey('heartRate', 'heartRate'),
    ),
  ).resolves.toMatchObject({ value: 'a2' });
  await expect(
    store.getSyncCheckpoint(healthKitAutoSyncCheckpointKey('heartRate')),
  ).resolves.toMatchObject({ value: 'requested' });
});
