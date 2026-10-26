import { openEncryptedStorage } from '../src';
import { runMigrations } from '../src/migrations';
import {
  createDatabase,
  createOptions,
  recordedAt,
  sampleRecord,
} from './manualHistoryTestSupport';

describe('manual history schema migration', () => {
  it('upgrades v2 without changing records and stores unknown dates explicitly', async () => {
    const database = createDatabase();
    const repository = await openEncryptedStorage(createOptions(database));
    await repository.put('source_record', sampleRecord);

    await database.execute('DROP TABLE manual_history_entries');
    await database.execute('PRAGMA user_version = 2');
    await runMigrations(database);

    expect((await database.execute('PRAGMA user_version')).rows[0].user_version).toBe(11);
    expect(await repository.get('source_record', sampleRecord.id)).toEqual(sampleRecord);
    await database.execute(
      'INSERT INTO manual_history_entries ' +
        '(id, entry_kind, effective_date, date_known, recorded_at, ingested_at, supersedes_id, payload_json) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        'synthetic-unknown-date',
        'note',
        null,
        0,
        recordedAt,
        recordedAt,
        null,
        JSON.stringify({ effectiveDate: { status: 'unknown' } }),
      ],
    );
    const rows = await database.execute(
      'SELECT effective_date, date_known FROM manual_history_entries WHERE id = ?',
      ['synthetic-unknown-date'],
    );
    expect(rows.rows).toEqual([{ effective_date: null, date_known: 0 }]);
    await expect(
      database.execute(
        'INSERT INTO manual_history_entries ' +
          '(id, entry_kind, effective_date, date_known, recorded_at, ingested_at, supersedes_id, payload_json) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ['synthetic-invalid-date', 'note', '2026-09-15', 0, recordedAt, recordedAt, null, '{}'],
      ),
    ).rejects.toThrow();
    await database.closeAsync?.();
  });

  it('adds manual-history storage when upgrading schema v10 without changing existing records', async () => {
    const database = createDatabase();
    const repository = await openEncryptedStorage(createOptions(database));
    await repository.put('source_record', sampleRecord);

    await database.execute('DROP TABLE manual_history_entries');
    await database.execute('PRAGMA user_version = 10');
    await runMigrations(database);

    expect((await database.execute('PRAGMA user_version')).rows[0].user_version).toBe(11);
    expect(await repository.get('source_record', sampleRecord.id)).toEqual(sampleRecord);
    expect(
      (
        await database.execute(
          "SELECT name FROM sqlite_master WHERE name = 'manual_history_entries'",
        )
      ).rows,
    ).toHaveLength(1);
    await database.closeAsync?.();
  });
});
