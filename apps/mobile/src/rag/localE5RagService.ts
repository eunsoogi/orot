import type {
  EmbeddingIndexOptions,
  EvidenceChunk,
  HybridEvidenceSearchHit,
  HybridSearchOptions,
} from '@orot/rag';
import {
  clearEvidenceIndex,
  deleteEvidenceChunks,
  indexEvidenceChunks,
  searchHybridEvidenceChunks,
} from '@orot/rag';
import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import { LocalE5EmbeddingProvider } from './localE5EmbeddingProvider';
import { localE5NativeBackend } from './localE5NativeBackend';
import { SqlCipherRagEmbeddingStorage } from '../storage/ragEmbeddingStorage';
import { SqlCipherRagFullTextSearchStore } from '../storage/ragFullTextSearch';
import { openLocalAgentMemoryDatabase } from '../storage/secureDatabase';

export interface LocalE5RagService {
  readonly provider: LocalE5EmbeddingProvider;
  /** Prepares tables before cleanup joins a caller-owned SQL transaction. */
  prepare(): Promise<void>;
  index(
    chunks: readonly EvidenceChunk[],
    options?: EmbeddingIndexOptions,
  ): Promise<void>;
  deleteChunks(
    chunks: readonly EvidenceChunk[],
    sourceRecordIds?: readonly string[],
    transaction?: SqlExecutor,
  ): Promise<void>;
  clear(
    sourceRecordIds?: readonly string[],
    transaction?: SqlExecutor,
  ): Promise<void>;
  search(
    query: string,
    chunks: readonly EvidenceChunk[],
    limit?: number,
    options?: HybridSearchOptions,
  ): Promise<readonly HybridEvidenceSearchHit[]>;
}

// Binds E5 vectors and SQLCipher full-text search to the app's already-open database.
export function createLocalE5RagService(
  database: SqlDatabase,
): LocalE5RagService {
  const provider = new LocalE5EmbeddingProvider(localE5NativeBackend);
  const storage = new SqlCipherRagEmbeddingStorage(database);
  const textSearch = new SqlCipherRagFullTextSearchStore(database);
  return {
    provider,
    prepare() {
      return storage.prepare();
    },
    index(chunks, options) {
      return indexEvidenceChunks(chunks, provider, storage, options);
    },
    deleteChunks(chunks, sourceRecordIds, transaction) {
      return deleteEvidenceChunks(
        chunks,
        storage,
        sourceRecordIds,
        transaction,
      );
    },
    clear(sourceRecordIds, transaction) {
      return clearEvidenceIndex(storage, sourceRecordIds, transaction);
    },
    search(query, chunks, limit, options) {
      return searchHybridEvidenceChunks(
        query,
        chunks,
        provider,
        storage,
        textSearch,
        limit,
        options,
      );
    },
  };
}

export async function openLocalE5RagService(): Promise<LocalE5RagService> {
  return createLocalE5RagService(await openLocalAgentMemoryDatabase());
}
