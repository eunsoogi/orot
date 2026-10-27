import type { EvidenceChunk } from './chunking';
import type { SqlExecutor } from '@orot/storage';
import type { LocalEmbeddingModelIdentity } from './localEmbeddings';

export interface PersistedLocalEmbedding {
  readonly chunkId: string;
  readonly vector: readonly number[];
}

export interface LocalEmbeddingWrite extends PersistedLocalEmbedding {
  readonly sourceRecordIds: readonly string[];
}

export interface RemovedEvidenceReferences {
  readonly sourceRecordIds: readonly string[];
  readonly chunkIds: readonly string[];
}

export interface LocalEmbeddingVectorStore {
  /** Persists source and chunk fences with vector removal in one transaction. */
  deleteEvidence(
    sourceRecordIds: readonly string[],
    chunkIds: readonly string[],
    transaction?: SqlExecutor,
  ): Promise<void>;
  /** Clears vectors and retains fences for known sources and every stored chunk. */
  clear(sourceRecordIds?: readonly string[], transaction?: SqlExecutor): Promise<void>;
  /** Matches tombstones across evidence identities and checks missing source and record rows. */
  findRemovedEvidence(
    sourceRecordIds: readonly string[],
    chunkIds: readonly string[],
    rootSourceRecordIds: readonly string[],
    localRecordIds?: readonly string[],
  ): Promise<RemovedEvidenceReferences>;
  upsertBatch(
    model: LocalEmbeddingModelIdentity,
    entries: readonly LocalEmbeddingWrite[],
    signal?: AbortSignal,
  ): Promise<void>;
  /** Restricts retrieval to candidate IDs when supplied; an empty page returns no vectors. */
  listForModel(
    model: LocalEmbeddingModelIdentity,
    chunkIds?: readonly string[],
  ): Promise<readonly PersistedLocalEmbedding[]>;
}

export interface EmbeddingIndexProgress {
  readonly stage: 'model_download' | 'embedding' | 'persisting';
  readonly completed: number;
  readonly total: number;
}

export interface EmbeddingIndexOptions {
  readonly batchSize?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: EmbeddingIndexProgress) => void;
}

/** Removes every persisted model vector for the requested evidence chunks. */
export async function deleteEvidenceChunks(
  chunks: readonly EvidenceChunk[],
  store: LocalEmbeddingVectorStore,
  sourceRecordIds: readonly string[] = [],
  transaction?: SqlExecutor,
): Promise<void> {
  const chunkIds = [...new Set(chunks.map((chunk) => chunk.id).filter(Boolean))];
  const removedSourceIds = new Set(sourceRecordIds.filter(Boolean));
  for (const chunk of chunks) {
    removedSourceIds.add(chunk.metadata.sourceId);
    for (const sourceRecordId of chunk.metadata.sourceRecordIds) {
      removedSourceIds.add(sourceRecordId);
    }
  }
  if (chunkIds.length === 0 && removedSourceIds.size === 0) return;
  await store.deleteEvidence([...removedSourceIds], chunkIds, transaction);
}

/** Removes the current local index while preserving source and stable-chunk fences. */
export function clearEvidenceIndex(
  store: LocalEmbeddingVectorStore,
  sourceRecordIds: readonly string[] = [],
  transaction?: SqlExecutor,
): Promise<void> {
  return store.clear([...new Set(sourceRecordIds.filter(Boolean))], transaction);
}
