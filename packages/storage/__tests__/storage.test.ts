import { openEncryptedStorage } from '../src';
import type { SqlDatabase, SqlExecutor, SqlResult, SqlTransaction, SqlValue } from '../src';

declare const require: (specifier: string) => unknown;

interface TestStatement {
  all(...parameters: SqlValue[]): Array<Record<string, SqlValue>>;
  run(...parameters: SqlValue[]): { changes: number };
}

interface TestConnection {
  prepare(query: string): TestStatement;
  exec(query: string): void;
  close(): void;
}

interface TestFileSystem {
  mkdtempSync(prefix: string): string;
  rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
}

interface TestOs {
  tmpdir(): string;
}

interface TestPath {
  join(...parts: string[]): string;
}

interface DatabaseSyncConstructor {
  new (path: string): TestConnection;
}

const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: DatabaseSyncConstructor };
const { mkdtempSync, rmSync } = require('node:fs') as TestFileSystem;
const { tmpdir } = require('node:os') as TestOs;
const { join } = require('node:path') as TestPath;

function createDatabase(path = ':memory:'): SqlDatabase {
  const connection = new DatabaseSync(path);
  const execute = async (query: string, parameters: SqlValue[] = []): Promise<SqlResult> => {
    const normalized = query.trim().toUpperCase();
    const statement = connection.prepare(query);
    if (normalized.startsWith('SELECT') || /^PRAGMA [A-Z_]+$/.test(normalized)) {
      return { rows: statement.all(...parameters) };
    }
    const result = statement.run(...parameters);
    return { rows: [], rowsAffected: result.changes };
  };
  const executor: SqlExecutor = { execute };
  return {
    ...executor,
    async transaction(operation: (transaction: SqlTransaction) => Promise<void>) {
      connection.exec('BEGIN IMMEDIATE');
      const transaction: SqlTransaction = {
        execute,
        commit: () => ({ rows: [] }),
        rollback: () => ({ rows: [] }),
      };
      try {
        await operation(transaction);
        connection.exec('COMMIT');
      } catch (error) {
        connection.exec('ROLLBACK');
        throw error;
      }
    },
    closeAsync: async () => connection.close(),
  };
}

const sampleRecord = {
  id: 'legacy-note',
  effectiveAt: '2026-01-01T00:00:00Z',
  recordedAt: '2026-01-01T00:00:00Z',
  ingestedAt: '2026-01-01T00:00:00Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  sourceKind: 'user_note',
  title: 'Synthetic legacy note',
};

function createOptions(database: SqlDatabase, secrets: { value: string | null }) {
  return {
    name: 'orot-test.db',
    keyStore: {
      async getSecret() {
        return secrets.value;
      },
      async setSecret(secret: string) {
        secrets.value = secret;
      },
    },
    randomBytes(target: Uint8Array) {
      target.forEach((_value, index) => {
        target[index] = index;
      });
    },
    openDatabase() {
      return database;
    },
  };
}

describe('encrypted local storage', () => {
  it('creates the typed and manual-history tables and migrates records from the earlier schema', async () => {
    const database = createDatabase();
    const secrets = { value: null as string | null };
    await database.execute(
      'CREATE TABLE records (record_type TEXT NOT NULL, payload_json TEXT NOT NULL)',
    );
    await database.execute('INSERT INTO records (record_type, payload_json) VALUES (?, ?)', [
      'source_record',
      JSON.stringify(sampleRecord),
    ]);
    const repository = await openEncryptedStorage(createOptions(database, secrets));

    expect(await repository.get('source_record', 'legacy-note')).toEqual(sampleRecord);
    const tables = await database.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    expect(tables.rows.map(row => row.name)).toEqual([
      'appointments',
      'dose_events',
      'encounters',
      'evidence_spans',
      'health_observations',
      'manual_history_entries',
      'medication_assertions',
      'source_records',
      'symptom_entries',
      'visit_briefs',
      'visit_questions',
    ]);
    expect((await database.execute('PRAGMA user_version')).rows[0].user_version).toBe(3);
    expect((await database.execute("SELECT name FROM sqlite_master WHERE name = 'records'")).rows)
      .toHaveLength(0);
    await database.closeAsync?.();
  });

  it('persists a random key through the secure store and rejects an unavailable store', async () => {
    const database = createDatabase();
    const secrets = { value: null as string | null };
    const repository = await openEncryptedStorage(createOptions(database, secrets));
    expect(secrets.value).toMatch(/^[0-9a-f]{64}$/);
    expect(await repository.get('source_record', 'missing')).toBeNull();
    await database.closeAsync?.();

    const failedDatabase = createDatabase();
    const failedSecrets = { value: null as string | null };
    const failedStore = createOptions(failedDatabase, failedSecrets);
    let databaseWasOpened = false;
    failedStore.keyStore.setSecret = async () => {
      throw new Error('keychain unavailable');
    };
    failedStore.openDatabase = () => {
      databaseWasOpened = true;
      throw new Error('database must not open without a saved key');
    };
    await expect(openEncryptedStorage(failedStore)).rejects.toThrow('keychain unavailable');
    expect(databaseWasOpened).toBe(false);
    await failedDatabase.closeAsync?.();
  });

  it('rolls back all writes when a transaction fails', async () => {
    const database = createDatabase();
    const repository = await openEncryptedStorage(
      createOptions(database, { value: 'ab'.repeat(32) }),
    );

    await expect(
      repository.transaction(async transaction => {
        await transaction.put('source_record', sampleRecord);
        throw new Error('abort transaction');
      }),
    ).rejects.toThrow('abort transaction');
    expect(await repository.get('source_record', 'legacy-note')).toBeNull();
    await database.closeAsync?.();
  });

  it('keeps the old schema intact when legacy data cannot be migrated', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'orot-storage-migration-'));
    const databasePath = join(directory, 'database.sqlite');
    const database = createDatabase(databasePath);
    await database.execute(
      'CREATE TABLE records (record_type TEXT NOT NULL, payload_json TEXT NOT NULL)',
    );
    await database.execute('INSERT INTO records (record_type, payload_json) VALUES (?, ?)', [
      'unknown_record',
      '{}',
    ]);

    await expect(
      openEncryptedStorage(createOptions(database, { value: 'cd'.repeat(32) })),
    ).rejects.toThrow('unsupported record type');
    const reopened = createDatabase(databasePath);
    expect((await reopened.execute('PRAGMA user_version')).rows[0].user_version).toBe(0);
    expect((await reopened.execute("SELECT name FROM sqlite_master WHERE name = 'records'")).rows)
      .toHaveLength(1);
    expect((await reopened.execute("SELECT name FROM sqlite_master WHERE name = 'source_records'")).rows)
      .toHaveLength(0);
    await reopened.closeAsync?.();
    rmSync(directory, { recursive: true, force: true });
  });
});
