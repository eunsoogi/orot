import type { HealthKitSampleChangesResult } from '../../types';
import { syncHealthKitBloodPressure } from '../sync';
import {
  correlation,
  createMemoryBloodPressureRepository,
} from '../testSupport';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => {
    resolve = accept;
  });
  return { promise, resolve };
}

type CompletedPage = Extract<
  HealthKitSampleChangesResult,
  { readonly status: 'completed' }
>;

function page(cursor: string | null): CompletedPage {
  return {
    availability: 'available',
    status: 'completed',
    readAuthorization: 'notObservable',
    addedSamples: [],
    deletedSampleIds: [],
    cursor,
    hasMore: false,
  };
}

describe('blood-pressure import concurrency', () => {
  it('waits for an active page before reading the next cursor', async () => {
    const store = createMemoryBloodPressureRepository();
    const firstPage = deferred<HealthKitSampleChangesResult>();
    let firstQueryStarted!: () => void;
    const started = new Promise<void>(resolve => {
      firstQueryStarted = resolve;
    });
    const firstHealthKit = {
      requestReadAuthorization: jest.fn(async () => ({
        availability: 'available' as const,
        requestStatus: 'completed' as const,
        readAuthorization: 'notObservable' as const,
      })),
      querySampleChanges: jest.fn(() => {
        firstQueryStarted();
        return firstPage.promise;
      }),
    };
    const nextHealthKit = {
      requestReadAuthorization: jest.fn(async () => ({
        availability: 'available' as const,
        requestStatus: 'completed' as const,
        readAuthorization: 'notObservable' as const,
      })),
      querySampleChanges: jest.fn(async () => page('cursor-2')),
    };

    const first = syncHealthKitBloodPressure({
      healthKit: firstHealthKit,
      repository: store.repository,
      now: () => '2026-10-05T10:00:00.000Z',
    });
    await started;
    const second = syncHealthKitBloodPressure({
      healthKit: nextHealthKit,
      repository: store.repository,
      now: () => '2026-10-05T10:00:01.000Z',
    });

    expect(nextHealthKit.querySampleChanges).not.toHaveBeenCalled();
    firstPage.resolve({
      ...page('cursor-1'),
      addedSamples: [correlation()],
    });
    await expect(first).resolves.toMatchObject({ status: 'completed' });
    await expect(second).resolves.toMatchObject({ status: 'completed' });
    expect(nextHealthKit.querySampleChanges).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: 'cursor-1' }),
    );
  });
});
