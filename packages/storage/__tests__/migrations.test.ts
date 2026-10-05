import { openEncryptedStorage } from '../src';
import type {
  RecordMap,
  SqlDatabase,
  SqlExecutor,
  SqlResult,
  SqlTransaction,
  SqlValue,
} from '../src';

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

interface DatabaseSyncConstructor {
  new (path: string): TestConnection;
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

const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: DatabaseSyncConstructor };
const { mkdtempSync, rmSync } = require('node:fs') as TestFileSystem;
const { tmpdir } = require('node:os') as TestOs;
const { join } = require('node:path') as TestPath;

function createDatabase(path = ':memory:'): SqlDatabase {
  const connection = new DatabaseSync(path);
  const execute = async (query: string, parameters: SqlValue[] = []): Promise<SqlResult> => {
    const normalized = query.trim().toUpperCase();
    const statement = connection.prepare(query);
    if (normalized.startsWith('SELECT') || normalized.startsWith('PRAGMA')) {
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
      try {
        await operation({ execute, commit: () => ({ rows: [] }), rollback: () => ({ rows: [] }) });
        connection.exec('COMMIT');
      } catch (error) {
        connection.exec('ROLLBACK');
        throw error;
      }
    },
    closeAsync: async () => connection.close(),
  };
}

function createOptions(database: SqlDatabase) {
  return {
    name: 'orot-migration-test.db',
    keyStore: {
      async getSecret() {
        return 'ab'.repeat(32);
      },
      async setSecret() {},
    },
    randomBytes(target: Uint8Array) {
      target.fill(1);
    },
    openDatabase() {
      return database;
    },
  };
}

const legacyRecord = {
  id: 'legacy-note',
  effectiveAt: '2026-01-01T00:00:00Z',
  recordedAt: '2026-01-01T00:00:00Z',
  ingestedAt: '2026-01-01T00:00:00Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  sourceKind: 'user_note',
  title: 'Synthetic legacy note',
};

describe('storage migrations', () => {
  it('creates typed tables and migrates records from the earlier schema', async () => {
    const database = createDatabase();
    await database.execute(
      'CREATE TABLE records (record_type TEXT NOT NULL, payload_json TEXT NOT NULL)',
    );
    await database.execute('INSERT INTO records (record_type, payload_json) VALUES (?, ?)', [
      'source_record',
      JSON.stringify(legacyRecord),
    ]);
    const repository = await openEncryptedStorage(createOptions(database));

    expect(await repository.get('source_record', 'legacy-note')).toEqual(legacyRecord);
    expect((await database.execute('PRAGMA user_version')).rows[0].user_version).toBe(6);
    expect(
      (await database.execute("SELECT name FROM sqlite_master WHERE name = 'records'")).rows,
    ).toHaveLength(0);
    await database.closeAsync?.();
  });

  it('adds medication storage and sync checkpoints to version two without changing old rows', async () => {
    const database = createDatabase();
    await database.execute(
      'CREATE TABLE source_records (id TEXT PRIMARY KEY NOT NULL, effective_at TEXT NOT NULL, recorded_at TEXT NOT NULL, ingested_at TEXT NOT NULL, payload_json TEXT NOT NULL)',
    );
    await database.execute(
      'INSERT INTO source_records (id, effective_at, recorded_at, ingested_at, payload_json) VALUES (?, ?, ?, ?, ?)',
      [
        legacyRecord.id,
        legacyRecord.effectiveAt,
        legacyRecord.recordedAt,
        legacyRecord.ingestedAt,
        JSON.stringify(legacyRecord),
      ],
    );
    await database.execute('PRAGMA user_version = 2');

    const repository = await openEncryptedStorage(createOptions(database));

    expect(await repository.get('source_record', 'legacy-note')).toEqual(legacyRecord);
    expect((await database.execute('PRAGMA user_version')).rows[0].user_version).toBe(6);
    expect(
      (
        await database.execute(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'healthkit_sync_checkpoints'",
        )
      ).rows,
    ).toHaveLength(1);
    await database.closeAsync?.();
  });

  it('makes imported observation source time nullable while preserving version-three rows', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'orot-health-observation-migration-'));
    const database = createDatabase(join(directory, 'database.sqlite'));
    const oldObservation = {
      id: 'healthkit-observation-before-v4',
      effectiveAt: '2026-10-01T08:00:00Z',
      recordedAt: '2026-10-01T08:00:00Z',
      ingestedAt: '2026-10-01T08:01:00Z',
      provenance: { origin: 'imported', sourceRecordIds: ['source-1'] },
      reviewState: { status: 'unreviewed' },
      observationKind: 'measurement',
      concept: 'body mass',
      value: { kind: 'quantity', amount: 70, unit: 'kg' },
    };
    await database.execute(
      'CREATE TABLE health_observations (id TEXT PRIMARY KEY NOT NULL, effective_at TEXT NOT NULL, recorded_at TEXT NOT NULL, ingested_at TEXT NOT NULL, payload_json TEXT NOT NULL)',
    );
    await database.execute(
      'INSERT INTO health_observations (id, effective_at, recorded_at, ingested_at, payload_json) VALUES (?, ?, ?, ?, ?)',
      [
        oldObservation.id,
        oldObservation.effectiveAt,
        oldObservation.recordedAt,
        oldObservation.ingestedAt,
        JSON.stringify(oldObservation),
      ],
    );
    await database.execute('PRAGMA user_version = 3');

    const repository = await openEncryptedStorage(createOptions(database));
    const importedObservation: RecordMap['health_observation'] = {
      id: 'healthkit-observation-without-source-time',
      effectiveAt: '2026-10-01T09:00:00Z',
      ingestedAt: '2026-10-01T09:02:00Z',
      provenance: { origin: 'imported', sourceRecordIds: ['source-2'] },
      reviewState: { status: 'unreviewed' },
      observationKind: 'measurement',
      concept: 'body mass',
      value: { kind: 'quantity', amount: 71, unit: 'kg' },
    };
    await repository.put('health_observation', importedObservation);

    expect(await repository.get('health_observation', oldObservation.id)).toEqual(oldObservation);
    expect(await repository.get('health_observation', importedObservation.id)).toEqual(
      importedObservation,
    );
    expect(
      (
        await database.execute(
          "SELECT \"notnull\" AS required FROM pragma_table_info('health_observations') WHERE name = 'recorded_at'",
        )
      ).rows[0].required,
    ).toBe(0);
    await database.closeAsync?.();
    rmSync(directory, { recursive: true, force: true });
  });
});
