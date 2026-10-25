import { NativeModules } from 'react-native';
import type { EvidenceChunk, LocalEmbeddingModelIdentity } from '@orot/rag';
import type { SqlExecutor } from '@orot/storage';

const TABLE = 'rag_vector_document_revisions';

/** Only a SHA-256 digest is persisted; removed health text cannot linger in this side table. */
export async function vectorDocumentFingerprint(
  chunk: EvidenceChunk,
  vector: readonly number[],
): Promise<string> {
  const bridge = NativeModules.OrotConsentFingerprint as
    { sha256(text: string): Promise<string> } | undefined;
  if (!bridge)
    throw new Error('Vector document fingerprinting is unavailable.');
  // Canonical metadata ignores property insertion order. Float32 rounding matches the vector blob.
  const snapshot = JSON.stringify(
    [chunk, Array.from(vector, Math.fround)],
    (_, value: unknown) => {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        return value;
      const object = value as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(object)
          .sort()
          .map(key => [key, object[key]]),
      );
    },
  );
  const digest = await bridge.sha256(snapshot);
  if (!/^[a-f0-9]{64}$/.test(digest))
    throw new Error('Invalid vector document fingerprint.');
  return digest;
}

/** Adapter-private cache metadata uses the same encrypted connection, without shared migrations. */
export async function prepareVectorRevisions(
  executor: SqlExecutor,
): Promise<void> {
  await executor.execute(
    `CREATE TABLE IF NOT EXISTS ${TABLE} (chunk_id TEXT NOT NULL, model_id TEXT NOT NULL, model_revision TEXT NOT NULL, fingerprint TEXT NOT NULL, PRIMARY KEY (chunk_id, model_id, model_revision))`,
  );
}

export async function saveVectorRevision(
  executor: SqlExecutor,
  model: LocalEmbeddingModelIdentity,
  chunkId: string,
  fingerprint: string,
): Promise<void> {
  // The caller writes this in the vector transaction so failures cannot bless an older vector.
  await executor.execute(
    `INSERT INTO ${TABLE} (chunk_id, model_id, model_revision, fingerprint) VALUES (?, ?, ?, ?) ON CONFLICT(chunk_id, model_id, model_revision) DO UPDATE SET fingerprint = excluded.fingerprint`,
    [chunkId, model.id, model.revision, fingerprint],
  );
}

export async function readVectorRevisions(
  executor: SqlExecutor,
  model: LocalEmbeddingModelIdentity,
  chunkIds: readonly string[],
): Promise<Map<string, string>> {
  const fingerprints = new Map<string, string>();
  for (let offset = 0; offset < chunkIds.length; offset += 100) {
    const ids = chunkIds.slice(offset, offset + 100);
    const result = await executor.execute(
      `SELECT chunk_id, fingerprint FROM ${TABLE} WHERE model_id = ? AND model_revision = ? AND chunk_id IN (${ids.map(() => '?').join(', ')})`,
      [model.id, model.revision, ...ids],
    );
    for (const row of result.rows) {
      if (
        typeof row.chunk_id === 'string' &&
        typeof row.fingerprint === 'string'
      ) {
        fingerprints.set(row.chunk_id, row.fingerprint);
      }
    }
  }
  return fingerprints;
}
