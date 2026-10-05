import { createRecordRepository, runMigrations } from '@orot/storage';
import type { SqlDatabase } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { syncHealthKitMedications } from '../importer';
import type { MedicationSyncOptions } from '../importer';
import { doseSample, now, page } from '../testSupport';

const checkpointKey = 'healthkit:medications:medicationDoseEvents';

function healthKitForDosePage() {
  let response = page(
    [doseSample('notLogged', 'HealthKit source')],
    'anchor-1',
  );
  const healthKit: MedicationSyncOptions['healthKit'] = {
    queryMedicationDefinitions: jest.fn().mockResolvedValue({
      availability: 'available',
      status: 'completed',
      readAuthorization: 'notObservable',
      completeSnapshot: true,
      medications: [],
    }),
    querySampleChanges: jest.fn(async () => response),
  };
  return {
    healthKit,
    setResponse(value: ReturnType<typeof page>) {
      response = value;
    },
  };
}

function failNextCheckpointWrite(database: SqlDatabase): () => void {
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

describe('HealthKit medication importer with SQLite storage', () => {
  it('stores an observed dose without source recordedAt and replays it idempotently', async () => {
    const { database, close } = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(database);
      const repository = createRecordRepository(database);
      const { healthKit, setResponse } = healthKitForDosePage();
      const options = { healthKit, repository, now: () => now };

      const first = await syncHealthKitMedications(options);
      const doseId = 'healthkit-dose-event:new-event-id';
      expect(first.doseEvents).toMatchObject({
        status: 'completed',
        upserted: 1,
      });
      const stored = await repository.get('dose_event', doseId);
      expect(stored).toMatchObject({
        eventKind: 'observed',
        observationStatus: 'not_logged',
        provenance: { origin: 'imported', sourceRecordIds: ['new-event-id'] },
      });
      expect(stored).not.toHaveProperty('recordedAt');
      expect(
        (
          await database.execute(
            'SELECT recorded_at FROM dose_events WHERE id = ?',
            [doseId],
          )
        ).rows[0]?.recorded_at,
      ).toBeNull();
      expect(await repository.getSyncCheckpoint(checkpointKey)).toMatchObject({
        value: 'anchor-1',
      });

      setResponse(
        page([doseSample('notLogged', 'HealthKit source')], 'anchor-1'),
      );
      const replay = await syncHealthKitMedications(options);
      expect(replay.doseEvents).toMatchObject({
        status: 'completed',
        upserted: 0,
      });
      expect(await repository.getSyncCheckpoint(checkpointKey)).toMatchObject({
        value: 'anchor-1',
      });
    } finally {
      close();
    }
  });

  it('rolls back a dose row when its checkpoint cannot be stored', async () => {
    const { database, close } = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(database);
      const repository = createRecordRepository(database);
      const { healthKit } = healthKitForDosePage();
      const restoreTransaction = failNextCheckpointWrite(database);

      await expect(
        syncHealthKitMedications({ healthKit, repository, now: () => now }),
      ).rejects.toThrow('simulated checkpoint persistence failure');
      expect(
        await repository.get('dose_event', 'healthkit-dose-event:new-event-id'),
      ).toBeNull();
      expect(await repository.getSyncCheckpoint(checkpointKey)).toBeNull();

      restoreTransaction();
      const recovered = await syncHealthKitMedications({
        healthKit,
        repository,
        now: () => now,
      });
      expect(recovered.doseEvents).toMatchObject({
        status: 'completed',
        upserted: 1,
      });
      expect(await repository.getSyncCheckpoint(checkpointKey)).toMatchObject({
        value: 'anchor-1',
      });
    } finally {
      close();
    }
  });
});
