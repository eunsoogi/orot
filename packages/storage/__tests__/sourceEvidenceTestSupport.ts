import type { SqlDatabase, SqlExecutor, SqlResult, SqlTransaction, SqlValue } from '../src';
import type { EvidenceSpanLocator } from '@orot/domain';

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

export const { mkdtempSync, rmSync } = require('node:fs') as TestFileSystem;
export const { tmpdir } = require('node:os') as { tmpdir(): string };
export const { join } = require('node:path') as {
  join(...parts: string[]): string;
};

export function createDatabase(path = ':memory:'): SqlDatabase {
  // Keep reopen and migration tests on Node's real SQLite implementation.
  const connection = new DatabaseSync(path);
  const execute = async (query: string, parameters: SqlValue[] = []): Promise<SqlResult> => {
    const normalized = query.trim().toUpperCase();
    const statement = connection.prepare(query);
    if (normalized.startsWith('SELECT') || /^PRAGMA [A-Z_]+$/.test(normalized)) {
      return { rows: statement.all(...parameters) };
    }
    return { rows: [], rowsAffected: statement.run(...parameters).changes };
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

export function options(database: SqlDatabase) {
  return {
    name: 'orot-source-evidence.db',
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

export const hashA = 'sha256:' + 'a'.repeat(64);
export const hashB = 'sha256:' + 'b'.repeat(64);

export function sourceRecord(id: string, contentHash = hashA, title = 'Synthetic source') {
  return {
    id,
    effectiveAt: '2026-01-01T00:00:00Z',
    recordedAt: '2026-01-01T00:00:00Z',
    ingestedAt: '2026-01-01T00:00:00Z',
    provenance: { origin: 'imported' as const, sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' as const },
    sourceKind: 'other' as const,
    title,
    contentHash,
  };
}

export function audioSourceRecord(id: string) {
  return { ...sourceRecord(id), sourceKind: 'audio_recording' as const };
}

export function evidenceSpan(id: string, sourceRecordId: string, locator: EvidenceSpanLocator) {
  return {
    id,
    effectiveAt: '2026-01-01T00:00:00Z',
    recordedAt: '2026-01-01T00:00:00Z',
    ingestedAt: '2026-01-01T00:00:00Z',
    provenance: { origin: 'derived' as const, sourceRecordIds: [sourceRecordId] },
    reviewState: { status: 'unreviewed' as const },
    sourceRecordId,
    text: 'Synthetic excerpt from the original source.',
    locator,
  };
}
