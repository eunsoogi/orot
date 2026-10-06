import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { syncHealthKitSleep, type SleepHealthKitClient } from '../importer';
import { page, sample, sleepRecordId } from '../sleepImporterFixtures';

describe('HealthKit sleep importer overlapping samples in SQLite', () => {
  it('stores distinct overlapping HealthKit IDs as separate raw observations', async () => {
    const { database, close } = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(database);
      const repository = createRecordRepository(database);
      const first = sample('overlap-first', {
        categoryValue: 3,
        startDate: '2026-10-01T22:00:00.000Z',
        endDate: '2026-10-01T23:00:00.000Z',
      });
      const second = sample('overlap-second', {
        categoryValue: 5,
        startDate: '2026-10-01T22:30:00.000Z',
        endDate: '2026-10-01T23:30:00.000Z',
      });
      const healthKit: SleepHealthKitClient = {
        querySampleChanges: jest
          .fn()
          .mockResolvedValue(page([first, second], 'overlap-anchor')),
      };

      const result = await syncHealthKitSleep({
        healthKit,
        repository,
        now: () => '2026-10-05T10:00:00.000Z',
      });
      const firstStored = await repository.get(
        'health_observation',
        sleepRecordId('overlap-first'),
      );
      const secondStored = await repository.get(
        'health_observation',
        sleepRecordId('overlap-second'),
      );

      // Overlapping intervals retain one evidence row per stable HealthKit ID.
      expect(result.upserted).toBe(2);
      expect(firstStored).toMatchObject({
        effectiveAt: first.startDate,
        endedAt: first.endDate,
        value: { kind: 'text', text: '3' },
        provenance: { sourceRecordIds: ['overlap-first'] },
      });
      expect(secondStored).toMatchObject({
        effectiveAt: second.startDate,
        endedAt: second.endDate,
        value: { kind: 'text', text: '5' },
        provenance: { sourceRecordIds: ['overlap-second'] },
      });
      expect(await repository.list('health_observation')).toHaveLength(2);
    } finally {
      close();
    }
  });
});
