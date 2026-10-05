import { createRecordRepository, runMigrations } from '@orot/storage';
import type { SqlDatabase } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { summarizeSleepByDay } from '../summary';
import { SLEEP_SAMPLE_CHECKPOINT_KEY, syncHealthKitSleep } from '../importer';
import type { SleepHealthKitClient } from '../importer';
import { mapHealthRecordToSleepObservation } from '../recordMapper';
import {
  page,
  sample,
  sleepRecordId,
  storedSample,
} from '../sleepImporterFixtures';

describe('HealthKit sleep importer with SQLite storage', () => {
  // Real SQLite covers null source times and atomic row-plus-cursor writes.
  it('persists changes, replays, deletions, and the cursor across real transactions', async () => {
    const { database, close } = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(database);
      const repository = createRecordRepository(database);
      await repository.put(
        'health_observation',
        storedSample(sample('removed')),
      );

      const updated = sample('sleep', {
        categoryValue: 5,
        sourceName: 'Updated sleep source',
      });
      const responses = new Map([
        [null, page([sample('sleep')], 'anchor-1', ['removed'], true)],
        ['anchor-1', page([updated], 'anchor-2', [], true)],
        ['anchor-2', page([updated], 'anchor-3', [], true)],
        ['anchor-3', page([], 'anchor-4', ['sleep'])],
      ]);
      const healthKit: SleepHealthKitClient = {
        querySampleChanges: jest.fn(async ({ cursor }) => {
          if (cursor === 'anchor-1') {
            const stored = await repository.get(
              'health_observation',
              sleepRecordId('sleep'),
            );
            expect(stored).toMatchObject({
              value: { kind: 'text', text: '1' },
              provenance: {
                source: {
                  sourceIdentifier: 'com.example.sleep',
                  sourceName: 'Sleep source',
                  sourceVersion: '2',
                  productType: 'watch',
                  device: { manufacturer: 'Example', model: 'Watch' },
                },
              },
            });
            expect(
              await repository.get(
                'health_observation',
                sleepRecordId('removed'),
              ),
            ).toBeNull();
            expect(
              await repository.getSyncCheckpoint(SLEEP_SAMPLE_CHECKPOINT_KEY),
            ).toMatchObject({ value: 'anchor-1' });
            expect(stored).not.toHaveProperty('recordedAt');
            const row = await database.execute(
              'SELECT recorded_at FROM health_observations WHERE id = ?',
              [sleepRecordId('sleep')],
            );
            expect(row.rows[0]?.recorded_at).toBeNull();
          }
          if (cursor === 'anchor-2') {
            const stored = await repository.get(
              'health_observation',
              sleepRecordId('sleep'),
            );
            expect(stored).toMatchObject({
              ingestedAt: '2026-10-05T10:01:00.000Z',
              value: { kind: 'text', text: '5' },
              provenance: { source: { sourceName: 'Updated sleep source' } },
            });
          }
          if (cursor === 'anchor-3') {
            const stored = await repository.get(
              'health_observation',
              sleepRecordId('sleep'),
            );
            expect(stored?.ingestedAt).toBe('2026-10-05T10:01:00.000Z');
            expect(
              await repository.getSyncCheckpoint(SLEEP_SAMPLE_CHECKPOINT_KEY),
            ).toMatchObject({ value: 'anchor-3' });
          }
          const response = responses.get(cursor);
          if (!response) throw new Error(`Unexpected sleep cursor: ${cursor}`);
          return response;
        }),
      };
      const times = [
        '2026-10-05T10:00:00.000Z',
        '2026-10-05T10:01:00.000Z',
        '2026-10-05T10:02:00.000Z',
        '2026-10-05T10:03:00.000Z',
      ];
      let timeIndex = 0;

      const result = await syncHealthKitSleep({
        healthKit,
        repository,
        now: () => times[timeIndex++]!,
      });

      expect(result).toMatchObject({
        status: 'completed',
        pages: 4,
        upserted: 2,
        deleted: 2,
        cursorAdvanced: true,
      });
      expect(
        await repository.get('health_observation', sleepRecordId('sleep')),
      ).toBeNull();
      expect(
        await repository.getSyncCheckpoint(SLEEP_SAMPLE_CHECKPOINT_KEY),
      ).toMatchObject({ value: 'anchor-4' });
      const remaining = await repository.list('health_observation');
      expect(
        summarizeSleepByDay(
          remaining
            .map(mapHealthRecordToSleepObservation)
            .filter(value => value !== null),
          { fromDay: '2026-10-05', throughDay: '2026-10-05', timeZone: 'UTC' },
        ),
      ).toMatchObject([{ status: 'noData', sampleCount: 0 }]);
    } finally {
      close();
    }
  });

  it('rolls back the sample and cursor together when checkpoint persistence fails', async () => {
    const { database, close } = openSqliteTestDatabase(':memory:');
    const restoreTransaction = failNextCheckpointWrite(database);
    try {
      await runMigrations(database);
      const repository = createRecordRepository(database);
      const healthKit: SleepHealthKitClient = {
        querySampleChanges: jest.fn(async () =>
          page([sample('retry')], 'anchor-1'),
        ),
      };
      const options = {
        healthKit,
        repository,
        now: () => '2026-10-05T10:00:00.000Z',
      };

      await expect(syncHealthKitSleep(options)).rejects.toThrow(
        'simulated checkpoint persistence failure',
      );
      expect(
        await repository.get('health_observation', sleepRecordId('retry')),
      ).toBeNull();
      expect(
        await repository.getSyncCheckpoint(SLEEP_SAMPLE_CHECKPOINT_KEY),
      ).toBeNull();

      restoreTransaction();
      const recovered = await syncHealthKitSleep(options);
      expect(recovered).toMatchObject({ status: 'completed', upserted: 1 });
      expect(
        await repository.get('health_observation', sleepRecordId('retry')),
      ).not.toBeNull();
      expect(
        await repository.getSyncCheckpoint(SLEEP_SAMPLE_CHECKPOINT_KEY),
      ).toMatchObject({ value: 'anchor-1' });
    } finally {
      restoreTransaction();
      close();
    }
  });
});

function failNextCheckpointWrite(database: SqlDatabase): () => void {
  // Fail after the row write so both the row and cursor must roll back.
  const originalTransaction = database.transaction.bind(database);
  let shouldFail = true;
  database.transaction = async operation => {
    await originalTransaction(async transaction => {
      await operation({
        execute: async (query, parameters = []) => {
          if (
            shouldFail &&
            query.startsWith('INSERT INTO healthkit_sync_checkpoints')
          ) {
            shouldFail = false;
            throw new Error('simulated checkpoint persistence failure');
          }
          return transaction.execute(query, parameters);
        },
        commit: () => transaction.commit(),
        rollback: () => transaction.rollback(),
      });
    });
  };
  return () => {
    database.transaction = originalTransaction;
  };
}
