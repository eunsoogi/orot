import { NativeModules } from 'react-native';
import { evidenceChunkToDocument, type EvidenceChunk } from '@orot/rag';
import { runMigrations } from '@orot/storage';
import type { SqlDatabase } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { SqlCipherVectorStore } from '../sqlCipherVectorStore';

declare const require: (specifier: string) => unknown;
const { createHash } = require('node:crypto') as {
  createHash(algorithm: string): {
    update(text: string): { digest(encoding: string): string };
  };
};

export const model = {
  id: 'synthetic-local-model',
  revision: 'revision-1',
  dimension: 2,
  modelSha256: 'a'.repeat(64),
  tokenizerSha256: 'b'.repeat(64),
};

/** Native SHA-256 is replaced only in tests; SQLite transactions remain real. */
export function installFingerprint(): void {
  NativeModules.OrotConsentFingerprint = {
    sha256: jest.fn(async (text: string) =>
      createHash('sha256').update(text).digest('hex'),
    ),
  };
}

export function chunk(id = 'chunk-a', sourceId = 'source-a'): EvidenceChunk {
  return {
    id,
    text: 'Synthetic consultation text',
    metadata: {
      sourceId,
      sourceRecordIds: [sourceId],
      evidenceId: 'evidence-' + id,
      evidenceLocator: { kind: 'audio_time_range', startMs: 0, endMs: 1000 },
      effectiveTime: '2026-10-01T10:00:00Z',
      recordType: 'transcript_segment',
      reviewState: { status: 'unreviewed' },
      transcriptRevision: {
        transcriptId: 'transcript-a',
        segmentOrdinal: 0,
        revision: 1,
      },
    },
  };
}

export function store(database: SqlDatabase, identity = model) {
  const embeddings = {
    modelIdentity: identity,
    embedDocuments: jest.fn(async (texts: string[]) => texts.map(() => [1, 0])),
    embedQuery: jest.fn(async (_text: string) => [1, 0]),
  };
  return {
    vectors: new SqlCipherVectorStore(embeddings, database),
    embeddings,
  };
}

export async function openDatabase(path = ':memory:') {
  const opened = openSqliteTestDatabase(path);
  await runMigrations(opened.database);
  for (const id of ['source-a', 'source-b', 'source-c']) {
    await opened.database.execute(
      'INSERT OR IGNORE INTO source_records (id, effective_at, recorded_at, ingested_at, payload_json) VALUES (?, ?, ?, ?, ?)',
      [id, '2026-10-01', '2026-10-01', '2026-10-01', JSON.stringify({ id })],
    );
  }
  return opened;
}

export const document = evidenceChunkToDocument;
