import type { RecordRepository } from '@orot/storage';
import type {
  HealthKitAuthorizationResult,
  HealthKitNativeModule,
} from '../../types';
import {
  createMemoryBloodPressureRepository,
  correlation,
} from '../../bloodPressure/testSupport';
import { createUnifiedFeatureImporter } from '../featureImporter';

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
    'query:started',
    'query:finished',
    'persistence:started',
    'persistence:finished',
  ]);
  expect(store.observations()).toHaveLength(2);
  expect(store.checkpoint('healthkit:bloodPressure:bloodPressure')?.value).toBe(
    'new-cursor',
  );
});
