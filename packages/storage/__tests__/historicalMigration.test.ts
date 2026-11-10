import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openEncryptedStorage } from '../src';
import { createVersionTwo, openMigrationDatabase } from './historicalMigrationSupport';
import { createOptions } from './manualHistoryTestSupport';
import { evidenceSpan, sourceRecord } from './sourceEvidenceTestSupport';

const source = sourceRecord('historical-source');
const evidence = evidenceSpan('historical-evidence', source.id, {
  kind: 'text_range',
  startOffset: 0,
  endOffset: 4,
});

async function seed(database: ReturnType<typeof openMigrationDatabase>['database']) {
  await createVersionTwo(database);
  for (const [table, record] of [
    ['source_records', source],
    ['evidence_spans', evidence],
  ] as const) {
    await database.execute(`INSERT INTO ${table} VALUES (?, ?, ?, ?, ?)`, [
      record.id,
      record.effectiveAt,
      record.recordedAt,
      record.ingestedAt,
      JSON.stringify(record),
    ]);
  }
}

describe('historical file database migration', () => {
  it('honors explicit transaction completion and rejects further transaction operations', async () => {
    const connection = openMigrationDatabase(':memory:');
    try {
      await connection.database.execute('CREATE TABLE test_values (value TEXT)');
      await connection.database.transaction(async (transaction) => {
        await transaction.execute("INSERT INTO test_values VALUES ('committed')");
        transaction.commit();
        await expect(transaction.execute('SELECT * FROM test_values')).rejects.toThrow('finalized');
        expect(() => transaction.rollback()).toThrow('finalized');
      });
      await connection.database.transaction(async (transaction) => {
        await transaction.execute("INSERT INTO test_values VALUES ('rolled back')");
        transaction.rollback();
      });
      expect((await connection.database.execute('SELECT value FROM test_values')).rows).toEqual([
        { value: 'committed' },
      ]);
    } finally {
      connection.close();
    }
  });

  it('preserves records and constraints after migration and reopen', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'orot-history-'));
    const path = join(directory, 'database.sqlite');
    let connection = openMigrationDatabase(path);
    try {
      await seed(connection.database);
      await openEncryptedStorage(createOptions(connection.database));
      connection.close();
      connection = openMigrationDatabase(path);
      const repository = await openEncryptedStorage(createOptions(connection.database));
      expect(await repository.get('source_record', source.id)).toEqual(source);
      expect(await repository.get('evidence_span', evidence.id)).toEqual(evidence);
      expect((await connection.database.execute('PRAGMA user_version')).rows[0].user_version).toBe(
        14,
      );
      await expect(
        connection.database.execute(
          'INSERT INTO manual_history_entries VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          ['invalid', 'note', '2026-01-01', 0, source.recordedAt, source.ingestedAt, null, '{}'],
        ),
      ).rejects.toThrow();
      await expect(
        connection.database.execute('INSERT INTO evidence_spans VALUES (?, ?, ?, ?, ?)', [
          'orphan',
          source.effectiveAt,
          source.recordedAt,
          source.ingestedAt,
          JSON.stringify({ ...evidence, id: 'orphan', sourceRecordId: 'missing' }),
        ]),
      ).rejects.toThrow();
    } finally {
      connection.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rolls back a partial migration, retains version and rows, then recovers on reopen', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'orot-history-failure-'));
    const path = join(directory, 'database.sqlite');
    let connection = openMigrationDatabase(path);
    try {
      await seed(connection.database);
      connection.close();
      connection = openMigrationDatabase(path, 'CREATE TABLE IF NOT EXISTS manual_history_entries');
      await expect(openEncryptedStorage(createOptions(connection.database))).rejects.toThrow(
        'injected migration failure',
      );
      connection.close();
      connection = openMigrationDatabase(path);
      expect((await connection.database.execute('PRAGMA user_version')).rows[0].user_version).toBe(
        2,
      );
      expect(
        (
          await connection.database.execute(
            "SELECT name FROM sqlite_master WHERE name = 'healthkit_sync_checkpoints'",
          )
        ).rows,
      ).toHaveLength(0);
      expect(
        (
          await connection.database.execute(
            'SELECT payload_json FROM evidence_spans WHERE id = ?',
            [evidence.id],
          )
        ).rows[0].payload_json,
      ).toBe(JSON.stringify(evidence));
      await openEncryptedStorage(createOptions(connection.database));
      connection.close();
      connection = openMigrationDatabase(path);
      const reopened = await openEncryptedStorage(createOptions(connection.database));
      expect(await reopened.get('source_record', source.id)).toEqual(source);
      expect(await reopened.get('evidence_span', evidence.id)).toEqual(evidence);
      expect((await connection.database.execute('PRAGMA user_version')).rows[0].user_version).toBe(
        14,
      );
    } finally {
      connection.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
