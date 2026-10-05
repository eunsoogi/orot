import { createRecordRepository, runMigrations } from '../src';
import type { RecordMap } from '../src';
import { openSqliteTestDatabase } from './sqliteTestDatabase';

describe('dose-event source-time migration', () => {
  it('upgrades version four without replacing unknown source time or old rows', async () => {
    const { database, close } = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(database);
      const oldRepository = createRecordRepository(database);
      const existingDose: RecordMap['dose_event'] = {
        id: 'healthkit-dose-event:recorded-before-v5',
        effectiveAt: '2026-10-01T08:00:00Z',
        recordedAt: '2026-10-01T08:01:00Z',
        ingestedAt: '2026-10-01T08:02:00Z',
        provenance: { origin: 'imported', sourceRecordIds: ['source-old'] },
        reviewState: { status: 'unreviewed' },
        eventKind: 'observed',
        medicationDefinitionId: 'healthkit-medication:concept-1',
        observationStatus: 'taken',
      };
      await oldRepository.put('dose_event', existingDose);

      // Restore the deployed v4 constraint before applying the upgrade.
      await database.execute('DROP INDEX IF EXISTS dose_events_effective_at_idx');
      await database.execute(
        'CREATE TABLE dose_events_v4 (' +
          'id TEXT PRIMARY KEY NOT NULL, effective_at TEXT NOT NULL, recorded_at TEXT NOT NULL, ' +
          'ingested_at TEXT NOT NULL, payload_json TEXT NOT NULL CHECK (json_valid(payload_json)))',
      );
      await database.execute(
        'INSERT INTO dose_events_v4 SELECT id, effective_at, recorded_at, ingested_at, payload_json FROM dose_events',
      );
      await database.execute('DROP TABLE dose_events');
      await database.execute('ALTER TABLE dose_events_v4 RENAME TO dose_events');
      await database.execute(
        'CREATE INDEX dose_events_effective_at_idx ON dose_events (effective_at)',
      );
      await database.execute('PRAGMA user_version = 4');

      await runMigrations(database);
      const repository = createRecordRepository(database);
      const importedDose: RecordMap['dose_event'] = {
        id: 'healthkit-dose-event:unknown-source-time',
        effectiveAt: '2026-10-01T09:00:00Z',
        ingestedAt: '2026-10-01T09:02:00Z',
        provenance: { origin: 'imported', sourceRecordIds: ['source-new'] },
        reviewState: { status: 'unreviewed' },
        eventKind: 'observed',
        medicationDefinitionId: 'healthkit-medication:concept-1',
        observationStatus: 'not_logged',
      };
      await repository.put('dose_event', importedDose);

      expect(await repository.get('dose_event', existingDose.id)).toEqual(existingDose);
      expect(await repository.get('dose_event', importedDose.id)).toEqual(importedDose);
      expect((await database.execute('PRAGMA user_version')).rows[0]?.user_version).toBe(5);
      expect(
        (
          await database.execute(
            "SELECT \"notnull\" AS required FROM pragma_table_info('dose_events') WHERE name = 'recorded_at'",
          )
        ).rows[0]?.required,
      ).toBe(0);
      expect(
        (
          await database.execute('SELECT recorded_at FROM dose_events WHERE id = ?', [
            importedDose.id,
          ])
        ).rows[0]?.recorded_at,
      ).toBeNull();
    } finally {
      close();
    }
  });
});
