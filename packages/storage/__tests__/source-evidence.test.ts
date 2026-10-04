import { describe, expect, it } from '@jest/globals';
import { openEncryptedStorage } from '../src';
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
const { mkdtempSync, rmSync } = require('node:fs') as TestFileSystem;
const { tmpdir } = require('node:os') as { tmpdir(): string };
const { join } = require('node:path') as { join(...parts: string[]): string };

function createDatabase(path = ':memory:'): SqlDatabase {
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

function options(database: SqlDatabase) {
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

const hashA = 'sha256:' + 'a'.repeat(64);
const hashB = 'sha256:' + 'b'.repeat(64);

function sourceRecord(id: string, contentHash = hashA, title = 'Synthetic source') {
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

function audioSourceRecord(id: string) {
  return { ...sourceRecord(id), sourceKind: 'audio_recording' as const };
}

function evidenceSpan(id: string, sourceRecordId: string, locator: EvidenceSpanLocator) {
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

describe('persistent source and evidence repositories', () => {
  it('deduplicates by content hash and reloads updated source relationships after reopen', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'orot-source-evidence-'));
    const databasePath = join(directory, 'database.sqlite');
    const firstDatabase = createDatabase(databasePath);
    const firstRepository = await openEncryptedStorage(options(firstDatabase));
    const createdSource = await firstRepository.sourceRecords.create(audioSourceRecord('source-1'));
    const duplicate = await firstRepository.sourceRecords.create({
      ...audioSourceRecord('source-duplicate'),
      title: 'Duplicate metadata must not replace the original',
    });
    const createdSpan = await firstRepository.evidenceSpans.create(
      evidenceSpan('span-1', 'source-1', {
        kind: 'audio_time_range',
        startMs: 1200,
        endMs: 2600,
      }),
    );

    expect(duplicate).toEqual(createdSource);
    expect(await firstRepository.sourceRecords.get('source-duplicate')).toBeNull();
    expect(await firstRepository.evidenceSpans.listForSourceRecord('source-1')).toEqual([
      createdSpan,
    ]);

    const updatedSource = { ...createdSource, title: 'Updated source', contentHash: hashB };
    const updatedSpan = {
      ...createdSpan,
      text: 'Updated excerpt.',
      locator: { kind: 'document_range' as const, pageNumber: 2, startOffset: 4, endOffset: 20 },
    };
    await firstRepository.sourceRecords.update(updatedSource);
    await firstRepository.evidenceSpans.update(updatedSpan);
    await firstDatabase.closeAsync?.();

    const reopenedDatabase = createDatabase(databasePath);
    const reopenedRepository = await openEncryptedStorage(options(reopenedDatabase));
    expect(await reopenedRepository.sourceRecords.findByContentHash(hashB)).toEqual(updatedSource);
    expect(await reopenedRepository.evidenceSpans.get('span-1')).toEqual(updatedSpan);
    expect(await reopenedRepository.evidenceSpans.listForSourceRecord('source-1')).toEqual([
      updatedSpan,
    ]);
    expect(await reopenedRepository.sourceRecords.delete('source-1')).toBe(true);
    expect(await reopenedRepository.evidenceSpans.get('span-1')).toBeNull();
    await reopenedDatabase.closeAsync?.();
    rmSync(directory, { recursive: true, force: true });
  });

  it('rejects missing parents, conflicting IDs, and duplicate hashes on update', async () => {
    const database = createDatabase();
    const repository = await openEncryptedStorage(options(database));

    await expect(
      repository.evidenceSpans.create(
        evidenceSpan('orphan-span', 'missing-source', {
          kind: 'text_range',
          startOffset: 0,
          endOffset: 4,
        }),
      ),
    ).rejects.toThrow('Evidence span source record does not exist.');
    await expect(
      repository.put(
        'evidence_span',
        evidenceSpan('generic-orphan-span', 'missing-source', {
          kind: 'text_range',
          startOffset: 0,
          endOffset: 4,
        }),
      ),
    ).rejects.toThrow('Evidence span source record does not exist.');

    const first = await repository.sourceRecords.create(sourceRecord('source-1', hashA));
    const second = await repository.sourceRecords.create(sourceRecord('source-2', hashB));
    const existingSpan = await repository.evidenceSpans.create(
      evidenceSpan('span-1', first.id, { kind: 'text_range', startOffset: 0, endOffset: 4 }),
    );
    const orphanUpdate = {
      ...existingSpan,
      sourceRecordId: 'missing-source',
      provenance: { ...existingSpan.provenance, sourceRecordIds: ['missing-source'] },
    };
    await expect(repository.evidenceSpans.update(orphanUpdate)).rejects.toThrow(
      'Evidence span source record does not exist.',
    );
    expect(await repository.evidenceSpans.get(existingSpan.id)).toEqual(existingSpan);
    await expect(repository.sourceRecords.create(sourceRecord('source-1', hashB))).rejects.toThrow(
      'Source record ID already exists with different content.',
    );
    await expect(
      repository.sourceRecords.update({ ...first, contentHash: second.contentHash }),
    ).rejects.toThrow('A source record with this content hash already exists.');
    expect(await repository.sourceRecords.findByContentHash(hashA)).toEqual(first);
    expect(await repository.sourceRecords.findByContentHash(hashB)).toEqual(second);
    await database.closeAsync?.();
  });

  it('upgrades schema v1 without rewriting legacy records or losing relationships', async () => {
    const database = createDatabase();
    await database.execute(
      'CREATE TABLE source_records (id TEXT PRIMARY KEY NOT NULL, effective_at TEXT NOT NULL, recorded_at TEXT NOT NULL, ingested_at TEXT NOT NULL, payload_json TEXT NOT NULL CHECK (json_valid(payload_json)))',
    );
    await database.execute(
      'CREATE TABLE evidence_spans (id TEXT PRIMARY KEY NOT NULL, effective_at TEXT NOT NULL, recorded_at TEXT NOT NULL, ingested_at TEXT NOT NULL, payload_json TEXT NOT NULL CHECK (json_valid(payload_json)))',
    );
    const legacySource = { ...sourceRecord('legacy-source') };
    delete (legacySource as { contentHash?: string }).contentHash;
    const legacySpan = { ...evidenceSpan('legacy-span', 'legacy-source', {
      kind: 'text_range', startOffset: 0, endOffset: 1,
    }) };
    delete (legacySpan as { locator?: EvidenceSpanLocator }).locator;
    await database.execute(
      'INSERT INTO source_records (id, effective_at, recorded_at, ingested_at, payload_json) VALUES (?, ?, ?, ?, ?)',
      ['legacy-source', legacySource.effectiveAt, legacySource.recordedAt, legacySource.ingestedAt, JSON.stringify(legacySource)],
    );
    await database.execute(
      'INSERT INTO evidence_spans (id, effective_at, recorded_at, ingested_at, payload_json) VALUES (?, ?, ?, ?, ?)',
      ['legacy-span', legacySpan.effectiveAt, legacySpan.recordedAt, legacySpan.ingestedAt, JSON.stringify(legacySpan)],
    );
    await database.execute('PRAGMA user_version = 1');

    const repository = await openEncryptedStorage(options(database));
    expect((await database.execute('PRAGMA user_version')).rows[0]?.user_version).toBe(2);
    expect(await repository.get('source_record', 'legacy-source')).toMatchObject({
      id: 'legacy-source',
    });
    expect(await repository.evidenceSpans.get('legacy-span')).toMatchObject({
      sourceRecordId: 'legacy-source',
      text: 'Synthetic excerpt from the original source.',
    });
    expect(await repository.sourceRecords.delete('legacy-source')).toBe(true);
    expect(await repository.evidenceSpans.get('legacy-span')).toBeNull();
    await database.closeAsync?.();
  });
});
