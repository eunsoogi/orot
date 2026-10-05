import type { HealthKitSampleChangesQuery } from '../../types';
import { mapHealthRecordToSleepObservation } from '../recordMapper';
import { summarizeSleepByDay } from '../summary';
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

  it('deleting the final stored sample leaves its day as no-data', async () => {
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
    const remaining = store
      .records()
      .map(mapHealthRecordToSleepObservation)
      .filter((value): value is NonNullable<typeof value> => value !== null);
    expect(result.deleted).toBe(1);
    expect(
      summarizeSleepByDay(remaining, {
        fromDay: '2026-10-01',
        throughDay: '2026-10-01',
        timeZone: 'UTC',
      })[0],
    ).toMatchObject({ status: 'noData', asleepDurationMs: 0 });
  });
});
