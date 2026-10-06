import type { HealthKitSampleChangesQuery } from '../../types';
import {
  SLEEP_SAMPLE_CHECKPOINT_KEY,
  SLEEP_SAMPLE_PAGE_SIZE,
  syncHealthKitSleep,
} from '../importer';
import type { SleepHealthKitClient } from '../importer';
import {
  checkpointFor,
  createStore,
  page,
  sample,
  sleepRecordId,
  storedSample,
} from '../sleepImporterFixtures';

describe('HealthKit sleep importer', () => {
  it('commits each change page before fetching the next and persists source metadata', async () => {
    const store = createStore([storedSample(sample('removed-sample'))]);
    const healthKit: SleepHealthKitClient = {
      querySampleChanges: jest.fn(
        async (query: HealthKitSampleChangesQuery) => {
          if (query.cursor === null) {
            expect(query).toEqual({
              feature: 'sleep',
              sampleKind: 'sleep',
              limit: SLEEP_SAMPLE_PAGE_SIZE,
              cursor: null,
            });
            return page(
              [sample('new-sample')],
              'anchor-1',
              ['removed-sample'],
              true,
            );
          }

          expect(query.cursor).toBe('anchor-1');
          expect(store.checkpoint()?.value).toBe('anchor-1');
          expect(store.record(sleepRecordId('new-sample'))).toMatchObject({
            value: { kind: 'text', text: '1' },
            provenance: {
              source: {
                system: 'healthkit',
                sourceIdentifier: 'com.example.sleep',
                sourceName: 'Sleep source',
                sourceVersion: '2',
                productType: 'watch',
                device: { manufacturer: 'Example', model: 'Watch' },
              },
            },
          });
          expect(store.record(sleepRecordId('new-sample'))).not.toHaveProperty(
            'recordedAt',
          );
          expect(store.record(sleepRecordId('removed-sample'))).toBeNull();
          expect(store.events.slice(-5)).toEqual([
            'begin',
            'put:' + sleepRecordId('new-sample'),
            'delete:' + sleepRecordId('removed-sample'),
            'checkpoint:anchor-1',
            'commit',
          ]);
          return page(
            [
              sample('new-sample', {
                categoryValue: 5,
                sourceName: 'Updated source',
              }),
            ],
            'anchor-2',
          );
        },
      ),
    };

    const result = await syncHealthKitSleep({
      healthKit,
      repository: store.repository,
      now: () => '2026-10-05T10:00:00.000Z',
    });
    expect(result).toMatchObject({
      status: 'completed',
      availability: 'available',
      readAuthorization: 'notObservable',
      pages: 2,
      upserted: 2,
      deleted: 1,
      cursorAdvanced: true,
    });
    expect(store.checkpoint()).toMatchObject({
      key: SLEEP_SAMPLE_CHECKPOINT_KEY,
      value: 'anchor-2',
    });
    expect(store.checkpointLookups).toEqual([SLEEP_SAMPLE_CHECKPOINT_KEY]);
    expect(store.record(sleepRecordId('new-sample'))).toMatchObject({
      value: { kind: 'text', text: '5' },
      provenance: { source: { sourceName: 'Updated source' } },
    });
  });

  it('replays a failed atomic write from the prior cursor without duplicate records', async () => {
    const store = createStore([], checkpointFor('anchor-1'));
    const healthKit: SleepHealthKitClient = {
      querySampleChanges: jest.fn(async () =>
        page([sample('retry-sample')], 'anchor-2'),
      ),
    };
    store.failNextCommit();
    const options = {
      healthKit,
      repository: store.repository,
      now: () => '2026-10-05T10:00:00.000Z',
    };

    await expect(syncHealthKitSleep(options)).rejects.toThrow(
      'storage commit failed',
    );
    expect(store.checkpoint()?.value).toBe('anchor-1');
    expect(store.record(sleepRecordId('retry-sample'))).toBeNull();

    const retry = await syncHealthKitSleep(options);
    expect(healthKit.querySampleChanges).toHaveBeenNthCalledWith(1, {
      feature: 'sleep',
      sampleKind: 'sleep',
      limit: SLEEP_SAMPLE_PAGE_SIZE,
      cursor: 'anchor-1',
    });
    expect(healthKit.querySampleChanges).toHaveBeenNthCalledWith(2, {
      feature: 'sleep',
      sampleKind: 'sleep',
      limit: SLEEP_SAMPLE_PAGE_SIZE,
      cursor: 'anchor-1',
    });
    expect(retry.upserted).toBe(1);
    expect(store.checkpoint()?.value).toBe('anchor-2');
    expect(store.records()).toHaveLength(1);
  });

  it('makes a replay of an unchanged sample idempotent and round-trips its category', async () => {
    const store = createStore();
    const unchanged = sample('stable-sample');
    const healthKit: SleepHealthKitClient = {
      querySampleChanges: jest
        .fn()
        .mockResolvedValueOnce(page([unchanged], 'anchor-1'))
        .mockResolvedValueOnce(page([unchanged], 'anchor-2')),
    };
    const options = {
      healthKit,
      repository: store.repository,
      now: () => '2026-10-05T10:00:00.000Z',
    };

    await syncHealthKitSleep(options);
    const repeated = await syncHealthKitSleep(options);
    expect(repeated.upserted).toBe(0);
    expect(store.records()).toHaveLength(1);
    expect(store.records()[0]).toMatchObject({
      effectiveAt: unchanged.startDate,
      endedAt: unchanged.endDate,
      concept: 'HKCategoryTypeIdentifierSleepAnalysis',
      value: { kind: 'text', text: '1' },
      provenance: {
        sourceRecordIds: ['stable-sample'],
        source: {
          sourceIdentifier: 'com.example.sleep',
          sourceName: 'Sleep source',
          device: { manufacturer: 'Example', model: 'Watch' },
        },
      },
    });
  });

  it('rejects a stalled page or conflicting IDs before opening a transaction', async () => {
    const store = createStore([], checkpointFor('anchor-1'));
    const healthKit: SleepHealthKitClient = {
      querySampleChanges: jest
        .fn()
        .mockResolvedValueOnce(page([], 'anchor-1', [], true))
        .mockResolvedValueOnce(page([sample('stale-id')], 'anchor-1'))
        .mockResolvedValueOnce(
          page([sample('same-id')], 'anchor-2', ['same-id']),
        ),
    };
    const options = {
      healthKit,
      repository: store.repository,
      now: () => '2026-10-05T10:00:00.000Z',
    };

    await expect(syncHealthKitSleep(options)).rejects.toMatchObject({
      code: 'STALLED_SLEEP_CURSOR',
    });
    expect(store.events).not.toContain('begin');
    await expect(syncHealthKitSleep(options)).rejects.toMatchObject({
      code: 'STALLED_SLEEP_CURSOR',
    });
    expect(store.events).not.toContain('begin');
    await expect(syncHealthKitSleep(options)).rejects.toMatchObject({
      code: 'CONFLICTING_SLEEP_SYNC_DELTA',
    });
    expect(store.events).not.toContain('begin');
  });
});
