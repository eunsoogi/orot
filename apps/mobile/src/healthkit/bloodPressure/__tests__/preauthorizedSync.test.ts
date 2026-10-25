import { syncHealthKitBloodPressure } from '../sync';
import {
  correlation,
  createMemoryBloodPressureRepository,
} from '../testSupport';
import type {
  HealthKitAuthorizationResult,
  HealthKitSampleChangesResult,
} from '../../types';
import type { BloodPressureSyncOptions } from '../types';

const authorization: Extract<
  HealthKitAuthorizationResult,
  { readonly availability: 'available' }
> = {
  availability: 'available',
  requestStatus: 'completed',
  readAuthorization: 'notObservable',
};

const page: Extract<
  HealthKitSampleChangesResult,
  { readonly status: 'completed' }
> = {
  availability: 'available',
  status: 'completed',
  readAuthorization: 'notObservable',
  addedSamples: [correlation()],
  deletedSampleIds: [],
  cursor: 'batch-cursor',
  hasMore: false,
};

test('uses the unified batch result without making a second single-feature request', async () => {
  const store = createMemoryBloodPressureRepository();
  const querySampleChanges = jest.fn().mockResolvedValue(page);
  const options: BloodPressureSyncOptions = {
    authorization,
    healthKit: { querySampleChanges },
    repository: store.repository,
    now: () => '2026-10-07T00:00:00.000Z',
  };

  await expect(syncHealthKitBloodPressure(options)).resolves.toMatchObject({
    status: 'completed',
    readAuthorization: 'notObservable',
    upserted: 2,
    cursorAdvanced: true,
  });
  expect(querySampleChanges).toHaveBeenCalledTimes(1);
  expect(store.observations()).toHaveLength(2);
});
