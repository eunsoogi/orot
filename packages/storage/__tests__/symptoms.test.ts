import { SymptomEntrySchema } from '@orot/domain';
import type { SymptomEntry } from '@orot/domain';
import { createSymptomRepository } from '../src/symptoms';
import { CURRENT_SCHEMA_VERSION, runMigrations } from '../src/migrations';
import type { SqlDatabase, SqlExecutor, SqlResult, SqlTransaction, SqlValue } from '../src/sql';

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

const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => TestConnection;
};
const { mkdtempSync, rmSync } = require('node:fs') as TestFileSystem;
const { tmpdir } = require('node:os') as { tmpdir(): string };
const { join } = require('node:path') as { join(...parts: string[]): string };

function createDatabase(path = ':memory:'): SqlDatabase {
  const connection = new DatabaseSync(path);
  const execute = async (query: string, parameters: SqlValue[] = []): Promise<SqlResult> => {
    const statement = connection.prepare(query);
    if (query.trim().toUpperCase().startsWith('SELECT') || /^PRAGMA [A-Z_]+$/.test(query.trim().toUpperCase())) {
      return { rows: statement.all(...parameters) };
    }
    return { rows: [], rowsAffected: statement.run(...parameters).changes };
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

function symptom(id: string, onsetAt: string, status: 'active' | 'resolved' = 'active'): SymptomEntry {
  return SymptomEntrySchema.parse({
    id,
    effectiveAt: onsetAt,
    recordedAt: '2026-05-01T12:00:00Z',
    ingestedAt: '2026-05-01T12:00:01Z',
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
    description: 'Synthetic intermittent hand tingling',
    status,
    ...(status === 'resolved' ? { resolvedAt: '2026-05-01T13:00:00Z' } : {}),
  });
}

describe('encrypted symptom repository', () => {
  it('reopens user-entered symptoms, edits details, resolves once, and queries by time and status', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'orot-symptoms-'));
    const databasePath = join(directory, 'symptoms.sqlite');
    const firstDatabase = createDatabase(databasePath);
    await runMigrations(firstDatabase);
    const firstRepository = createSymptomRepository(firstDatabase);
    const created = symptom('symptom-1', '2026-04-20T08:30:00+09:00');
    expect(await firstRepository.create(created)).toEqual(created);
    await firstDatabase.closeAsync?.();

    const reopenedDatabase = createDatabase(databasePath);
    await runMigrations(reopenedDatabase);
    const repository = createSymptomRepository(reopenedDatabase);
    const reopened = await repository.get(created.id);
    expect(reopened).toEqual(created);
    const edited = SymptomEntrySchema.parse({ ...reopened, description: 'Tingling after exercise' });
    expect(await repository.update(edited)).toEqual(edited);
    expect(await repository.resolve(created.id, '2026-05-01T14:00:00Z')).toMatchObject({
      effectiveAt: created.effectiveAt,
      recordedAt: created.recordedAt,
      ingestedAt: created.ingestedAt,
      status: 'resolved',
      resolvedAt: '2026-05-01T14:00:00Z',
    });
    await expect(repository.resolve(created.id, '2026-05-01T15:00:00Z')).rejects.toThrow(
      'A resolved symptom cannot be resolved again.',
    );
    expect(await repository.list({
      status: 'resolved',
      fromOnsetAt: '2026-04-19T23:30:00Z',
      throughOnsetAt: '2026-04-19T23:30:00Z',
    })).toMatchObject([{ id: 'symptom-1', status: 'resolved' }]);
    expect((await reopenedDatabase.execute('PRAGMA user_version')).rows[0]?.user_version)
      .toBe(CURRENT_SCHEMA_VERSION);
    await reopenedDatabase.closeAsync?.();
    rmSync(directory, { recursive: true, force: true });
  });

  it('rejects timestamp/provenance rewrites and non-user-entered journal data', async () => {
    const database = createDatabase();
    await runMigrations(database);
    const repository = createSymptomRepository(database);
    const created = symptom('symptom-1', '2026-04-20T08:30:00Z');
    await repository.create(created);
    const changedHistory = SymptomEntrySchema.parse({
      ...created,
      effectiveAt: '2026-04-21T08:30:00Z',
    });
    await expect(repository.update(changedHistory)).rejects.toThrow(
      'Symptom history and provenance cannot be rewritten.',
    );
    expect(await repository.get(created.id)).toEqual(created);
    await expect(repository.create(SymptomEntrySchema.parse({
      ...created,
      id: 'clinician-symptom',
      provenance: { origin: 'clinician_recorded', sourceRecordIds: [] },
    }))).rejects.toThrow('Journal symptoms must remain user-entered and unreviewed.');
    await database.closeAsync?.();
  });

  it('reads legacy entries without a status and filters timestamp offsets precisely', async () => {
    const database = createDatabase();
    await runMigrations(database);
    const legacy = { ...symptom('legacy', '2026-01-01T02:00:00+02:00') } as
      Record<string, unknown>;
    delete legacy.status;
    await database.execute(
      'INSERT INTO symptom_entries (id, effective_at, recorded_at, ingested_at, payload_json) VALUES (?, ?, ?, ?, ?)',
      [legacy.id as string, legacy.effectiveAt as string, legacy.recordedAt as string,
        legacy.ingestedAt as string, JSON.stringify(legacy)],
    );
    await repositoryWith(database).create(symptom('after', '2026-01-01T00:00:00.000000001Z'));

    expect(await repositoryWith(database).list({
      fromOnsetAt: '2026-01-01T00:00:00Z',
      throughOnsetAt: '2026-01-01T00:00:00Z',
      status: 'active',
    })).toMatchObject([{ id: 'legacy', status: 'active' }]);
    await expect(repositoryWith(database).list({
      fromOnsetAt: '2026-01-02T00:00:00Z',
      throughOnsetAt: '2026-01-01T00:00:00Z',
    })).rejects.toThrow();
    await database.closeAsync?.();
  });
});

function repositoryWith(database: SqlDatabase) {
  return createSymptomRepository(database);
}
