import type { EmbeddingIndexOptions, LocalEmbeddingSearchHit } from '@orot/rag';
import { indexEvidenceChunks, searchEvidenceChunks } from '@orot/rag';
import type { EvidenceChunk } from '@orot/rag';
import type { SqlDatabase } from '@orot/storage';
import { LocalE5EmbeddingProvider } from './localE5EmbeddingProvider';
import { localE5NativeBackend } from './localE5NativeBackend';
import { SqlCipherRagEmbeddingStorage } from '../storage/ragEmbeddingStorage';
import { openLocalAgentMemoryDatabase } from '../storage/secureDatabase';

export interface LocalE5RagService {
  readonly provider: LocalE5EmbeddingProvider;
  index(
    chunks: readonly EvidenceChunk[],
    options?: EmbeddingIndexOptions,
  ): Promise<void>;
  search(
    query: string,
    chunks: readonly EvidenceChunk[],
    limit?: number,
    options?: Omit<
      Parameters<LocalE5EmbeddingProvider['embedQueries']>[0],
      'input'
    >,
  ): Promise<readonly LocalEmbeddingSearchHit[]>;
}

// Binds the provider-neutral embedding API to vectors in the app's already-open SQLCipher database.
export function createLocalE5RagService(
  database: SqlDatabase,
): LocalE5RagService {
  const provider = new LocalE5EmbeddingProvider(localE5NativeBackend);
  const storage = new SqlCipherRagEmbeddingStorage(database);
  return {
    provider,
    index(chunks, options) {
      return indexEvidenceChunks(chunks, provider, storage, options);
    },
    search(query, chunks, limit, options) {
      return searchEvidenceChunks(
        query,
        chunks,
        provider,
        storage,
        limit,
        options,
      );
    },
  };
}

export async function openLocalE5RagService(): Promise<LocalE5RagService> {
  return createLocalE5RagService(await openLocalAgentMemoryDatabase());
}
