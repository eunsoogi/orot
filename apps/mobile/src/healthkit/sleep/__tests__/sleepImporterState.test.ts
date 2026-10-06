import type { HealthKitSampleChangesQuery } from '../../types';
import { syncHealthKitSleep, type SleepHealthKitClient } from '../importer';
import {
  createStore,
  page,
  sample,
  sleepRecordId,
  storedSample,
} from '../sleepImporterFixtures';

describe('HealthKit sleep importer state', () => {
  it('keeps the last committed page when HealthKit becomes unavailable mid-sync', async () => {
    const store = createStore();
    const healthKit: SleepHealthKitClient = {
      querySampleChanges: jest.fn(
        async (query: HealthKitSampleChangesQuery) => {
          if (query.cursor === null) {
            return page([sample('first-page')], 'anchor-1', [], true);
          }
          return {
            availability: 'unavailable',
            status: 'notRun',
            readAuthorization: 'notObservable',
          } as const;
        },
      ),
    };

    const result = await syncHealthKitSleep({
      healthKit,
      repository: store.repository,
      now: () => '2026-10-05T10:00:00.000Z',
    });

    expect(result).toMatchObject({
      status: 'partial',
      availability: 'unavailable',
      pages: 1,
      upserted: 1,
      cursorAdvanced: true,
    });
    expect(store.checkpoint()?.value).toBe('anchor-1');
    expect(store.record(sleepRecordId('first-page'))).not.toBeNull();
  });

  it('deleting the final stored sample leaves no imported sleep evidence', async () => {
    const store = createStore([storedSample(sample('last-sample'))]);
    const healthKit: SleepHealthKitClient = {
      querySampleChanges: jest
        .fn()
        .mockResolvedValue(page([], 'anchor-2', ['last-sample'])),
    };
    const result = await syncHealthKitSleep({
      healthKit,
      repository: store.repository,
      now: () => '2026-10-05T10:00:00.000Z',
    });
    expect(result.deleted).toBe(1);
    expect(store.records()).toEqual([]);
  });
});
