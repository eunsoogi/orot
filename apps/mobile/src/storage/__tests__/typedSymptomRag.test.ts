import { LOCAL_EMBEDDING_IDENTITY, chunkStructuredRecord } from '@orot/rag';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import { eligibleHybridChunks } from '../../../../../packages/rag/src/hybridRetriever/eligibility';
import { eligibleLexicalEvidence } from '../../rag/lexicalEvidenceEligibility';
import { eligibleVectorChunks } from '../ragVectorStoreEvidence';
import { createHealthEvidenceTestDatabase } from '../../healthEvidence/localEvidenceTestSupport';
import { SqlCipherRagEmbeddingStorage } from '../ragEmbeddingStorage';
declare const require: (name: string) => unknown;
const { mkdtempSync, rmSync } = require('node:fs') as {
  mkdtempSync(prefix: string): string;
  rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
};
const { tmpdir } = require('node:os') as { tmpdir(): string };
const { join } = require('node:path') as { join(...parts: string[]): string };

test('typed symptom fences reject delayed indexing while preserving a different kind with the same ID', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-symptom-rag-'));
  const path = join(directory, 'records.sqlite');
  const first = createHealthEvidenceTestDatabase(path);
  const { database } = first;
  let reopened: ReturnType<typeof createHealthEvidenceTestDatabase> | undefined;
  try {
    await runMigrations(database);
    const storage = new SqlCipherRagEmbeddingStorage(database);
    await storage.prepare();
    await database.execute(
      'CREATE TABLE IF NOT EXISTS legacy_symptom_deleted (id TEXT PRIMARY KEY NOT NULL)',
    );
    await database.execute(
      'INSERT INTO legacy_symptom_deleted (id) VALUES (?)',
      ['shared'],
    );
    const vector = Array.from(
      { length: LOCAL_EMBEDDING_IDENTITY.dimension },
      () => 0.1,
    );
    const entry = { chunkId: 'late', vector, sourceRecordIds: ['shared'] };
    await expect(
      storage.upsertBatch(LOCAL_EMBEDDING_IDENTITY, [
        {
          ...entry,
          sourceReferences: [{ kind: 'symptom_entry', id: 'shared' }],
        },
      ]),
    ).rejects.toThrow('Removed symptom');
    await expect(
      storage.upsertBatch(LOCAL_EMBEDDING_IDENTITY, [entry]),
    ).rejects.toThrow('Removed symptom');
    await storage.upsertBatch(LOCAL_EMBEDDING_IDENTITY, [
      {
        ...entry,
        sourceReferences: [{ kind: 'health_observation', id: 'shared' }],
      },
    ]);
    first.close();
    reopened = createHealthEvidenceTestDatabase(path);
    const afterRestart = new SqlCipherRagEmbeddingStorage(reopened.database);
    expect(
      await afterRestart.findRemovedTypedEvidence([
        { kind: 'symptom_entry', id: 'shared' },
        { kind: 'health_observation', id: 'shared' },
      ]),
    ).toEqual([{ kind: 'symptom_entry', id: 'shared' }]);
    expect(
      await afterRestart.listForModel(LOCAL_EMBEDDING_IDENTITY, ['late']),
    ).toHaveLength(1);
    await expect(
      afterRestart.upsertBatch(LOCAL_EMBEDDING_IDENTITY, [
        {
          ...entry,
          sourceReferences: [{ kind: 'symptom_entry', id: 'shared' }],
        },
      ]),
    ).rejects.toThrow('Removed symptom');
  } finally {
    if (reopened) reopened.close();
    else first.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('retained candidate pages exclude the deleted kind but keep a same-ID health record', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    const records = createRecordRepository(database);
    const observation = healthObservation(
      'shared',
      'heart_rate',
      '2026-10-01T12:00:00Z',
    );
    const symptom = {
      id: 'shared',
      description: 'Old symptom',
      status: 'active' as const,
      effectiveAt: '2026-10-01T12:00:00Z',
      recordedAt: '2026-10-01T12:00:00Z',
      ingestedAt: '2026-10-01T12:00:00Z',
      provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' as const },
    };
    await records.put('health_observation', observation);
    await database.execute(
      'CREATE TABLE IF NOT EXISTS legacy_symptom_deleted (id TEXT PRIMARY KEY NOT NULL)',
    );
    await database.execute(
      'INSERT INTO legacy_symptom_deleted (id) VALUES (?)',
      ['shared'],
    );
    const storage = new SqlCipherRagEmbeddingStorage(database);
    await storage.prepare();
    const removed = chunkStructuredRecord('symptom_entry', symptom);
    const retained = chunkStructuredRecord('health_observation', observation);
    expect(await eligibleLexicalEvidence([removed, retained], storage)).toEqual(
      [retained],
    );
    expect(await eligibleVectorChunks([removed, retained], storage)).toEqual([
      retained,
    ]);
    expect(await eligibleHybridChunks([removed, retained], storage)).toEqual([
      retained,
    ]);
  } finally {
    close();
  }
});
