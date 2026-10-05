import { syncHealthKitBloodPressure } from '../sync';
import {
  BLOOD_PRESSURE_CHECKPOINT_KEY,
  applyBloodPressureChanges,
} from '../importChanges';
import type {
  HealthKitSampleChangesQuery,
  HealthKitSampleChangesResult,
} from '../../types';
import type { BloodPressureHealthKitClient } from '../types';
import {
  correlation,
  createMemoryBloodPressureRepository,
} from '../testSupport';

type CompletedPage = Extract<
  HealthKitSampleChangesResult,
  { readonly status: 'completed' }
>;

function page(
  addedSamples: CompletedPage['addedSamples'] = [],
  deletedSampleIds: readonly string[] = [],
  cursor: string | null = null,
  hasMore = false,
): CompletedPage {
  return {
    availability: 'available',
    status: 'completed',
    readAuthorization: 'notObservable',
    addedSamples,
    deletedSampleIds,
    cursor,
    hasMore,
  };
}

describe('syncHealthKitBloodPressure', () => {
  it('commits each added/deleted page before querying the next cursor', async () => {
    const store = createMemoryBloodPressureRepository();
    const now = () => '2026-10-05T10:00:00.000Z';
    await applyBloodPressureChanges(
      store.repository,
      page([correlation('old')]),
      null,
      now,
    );
    const cursors: (string | null)[] = [];
    const healthKit: BloodPressureHealthKitClient = {
      async querySampleChanges(query: HealthKitSampleChangesQuery) {
        cursors.push(query.cursor);
        if (cursors.length === 1) {
          expect(query).toEqual({
            feature: 'bloodPressure',
            sampleKind: 'bloodPressure',
            limit: 200,
            cursor: null,
          });
          return page([correlation('new')], [], 'cursor-1', true);
        }
        expect(
          await store.repository.getSyncCheckpoint(
            BLOOD_PRESSURE_CHECKPOINT_KEY,
          ),
        ).toMatchObject({ value: 'cursor-1' });
        return page([], ['old'], 'cursor-2');
      },
    };

    const result = await syncHealthKitBloodPressure({
      healthKit,
      repository: store.repository,
      now,
    });

    expect(cursors).toEqual([null, 'cursor-1']);
    expect(result).toEqual({
      status: 'completed',
      upserted: 2,
      deleted: 2,
      cursorAdvanced: true,
    });
    expect(store.observations()).toHaveLength(2);
    expect(store.checkpoint(BLOOD_PRESSURE_CHECKPOINT_KEY)?.value).toBe(
      'cursor-2',
    );
  });

  it('retries a failed page from the old cursor because records and checkpoint roll back together', async () => {
    const store = createMemoryBloodPressureRepository();
    const queriedCursors: (string | null)[] = [];
    const healthKit: BloodPressureHealthKitClient = {
      async querySampleChanges(query) {
        queriedCursors.push(query.cursor);
        return page([correlation()], [], 'cursor-1');
      },
    };
    const options = {
      healthKit,
      repository: store.repository,
      now: () => '2026-10-05T10:00:00.000Z',
    };

    store.failNextCheckpointWrite();
    await expect(syncHealthKitBloodPressure(options)).rejects.toThrow(
      'simulated checkpoint write failure',
    );
    expect(store.observations()).toHaveLength(0);
    expect(store.checkpoint(BLOOD_PRESSURE_CHECKPOINT_KEY)).toBeNull();

    await expect(syncHealthKitBloodPressure(options)).resolves.toMatchObject({
      status: 'completed',
      upserted: 2,
      cursorAdvanced: true,
    });
    expect(queriedCursors).toEqual([null, null]);
    expect(store.observations()).toHaveLength(2);
  });

  it('reports unavailable access without advancing the stored cursor', async () => {
    const store = createMemoryBloodPressureRepository();
    const healthKit: BloodPressureHealthKitClient = {
      async querySampleChanges() {
        return {
          availability: 'unsupportedPlatform',
          status: 'notRun',
          readAuthorization: 'notObservable',
        };
      },
    };

    await expect(
      syncHealthKitBloodPressure({
        healthKit,
        repository: store.repository,
        now: () => '2026-10-05T10:00:00.000Z',
      }),
    ).resolves.toEqual({
      status: 'notRun',
      upserted: 0,
      deleted: 0,
      cursorAdvanced: false,
    });
    expect(store.observations()).toHaveLength(0);
    expect(store.checkpoint(BLOOD_PRESSURE_CHECKPOINT_KEY)).toBeNull();
  });

  it('stops a has-more response that repeats the same cursor', async () => {
    const store = createMemoryBloodPressureRepository();
    const healthKit: BloodPressureHealthKitClient = {
      async querySampleChanges() {
        return page([], [], null, true);
      },
    };

    await expect(
      syncHealthKitBloodPressure({
        healthKit,
        repository: store.repository,
        now: () => '2026-10-05T10:00:00.000Z',
      }),
    ).rejects.toThrow('without advancing its cursor');
    expect(store.checkpoint(BLOOD_PRESSURE_CHECKPOINT_KEY)).toBeNull();
  });
});
