import type {
  EmbeddingIndexOptions,
  EvidenceChunk,
  HybridEvidenceSearchHit,
  HybridSearchOptions,
} from '@orot/rag';
import {
  clearEvidenceIndex,
  deleteEvidenceChunks,
  evidenceChunkToDocument,
  HybridRetriever,
  LocalEmbeddingJobError,
} from '@orot/rag';
import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import { LocalE5EmbeddingProvider } from './localE5EmbeddingProvider';
import { LocalE5Embeddings } from './localE5Embeddings';
import { LocalLexicalRetriever } from './localLexicalRetriever';
import { PagedVectorRetriever } from './pagedVectorRetriever';
import { localE5NativeBackend } from './localE5NativeBackend';
import { SqlCipherRagEmbeddingStorage } from '../storage/ragEmbeddingStorage';
import { SqlCipherRagFullTextSearchStore } from '../storage/ragFullTextSearch';
import { SqlCipherVectorStore } from '../storage/sqlCipherVectorStore';
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

function throwIfCancelled(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('Local embedding was cancelled.');
  error.name = 'AbortError';
  throw error;
}

/** Cancellation during a vector write must roll back its owning SQL transaction. */
function cancellableDatabase(
  database: SqlDatabase,
  signal?: AbortSignal,
): SqlDatabase {
  return {
    execute: (sql, values) => database.execute(sql, values),
    transaction: operation =>
      database.transaction(transaction =>
        operation({
          ...transaction,
          async execute(sql, values) {
            throwIfCancelled(signal);
            const result = await transaction.execute(sql, values);
            throwIfCancelled(signal);
            return result;
          },
        }),
      ),
  };
}

// Standard adapters share the app's open encrypted connection; legacy provider stays public.
export function createLocalE5RagService(
  database: SqlDatabase,
): LocalE5RagService {
  const provider = new LocalE5EmbeddingProvider(localE5NativeBackend);
  const embeddings = new LocalE5Embeddings(localE5NativeBackend);
  const storage = new SqlCipherRagEmbeddingStorage(database);
  const textSearch = new SqlCipherRagFullTextSearchStore(database);
  return {
    provider,
    prepare() {
      return storage.prepare();
    },
    async index(chunks, options = {}) {
      const batchSize = options.batchSize ?? 4;
      if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 8) {
        throw new LocalEmbeddingJobError(
          'invalid_request',
          'Embedding batch size must be between 1 and 8.',
        );
      }
      // Snapshot text and citations together before native inference yields control.
      const documents = chunks.map(evidenceChunkToDocument);
      const seen = new Set<string>();
      for (const document of documents) {
        if (
          !document.id ||
          !document.pageContent.trim() ||
          seen.has(document.id)
        ) {
          throw new LocalEmbeddingJobError(
            'invalid_request',
            'Evidence chunks need unique IDs and non-empty text.',
          );
        }
        seen.add(document.id);
      }
      const vectors = new SqlCipherVectorStore(
        embeddings,
        cancellableDatabase(database, options.signal),
      );
      // Keep committed bounded batches retryable, with the existing aggregate progress units.
      for (let offset = 0; offset < documents.length; offset += batchSize) {
        throwIfCancelled(options.signal);
        const batch = documents.slice(offset, offset + batchSize);
        const values = await embeddings.embedDocuments(
          batch.map(document => document.pageContent),
          {
            batchSize,
            signal: options.signal,
            onProgress: progress =>
              options.onProgress?.(
                progress.stage === 'model_download'
                  ? progress
                  : {
                      stage: 'embedding',
                      completed: offset + progress.completed,
                      total: documents.length,
                    },
              ),
          },
        );
        throwIfCancelled(options.signal);
        await vectors.addVectors(values, batch);
        options.onProgress?.({
          stage: 'persisting',
          completed: offset + batch.length,
          total: documents.length,
        });
      }
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
    async search(query, chunks, limit, options = {}) {
      // Bind job controls per search, never on shared adapter state: record and transcript
      // searches run concurrently with independent cancellation and progress callbacks.
      const vectors = new SqlCipherVectorStore(
        {
          modelIdentity: embeddings.modelIdentity,
          embedDocuments: texts => embeddings.embedDocuments(texts, options),
          embedQuery: text => embeddings.embedQuery(text, options),
        },
        database,
      );
      return new HybridRetriever({
        chunks,
        limit,
        filters: options.filters,
        ranking: options.ranking,
        removalReader: storage,
        createLexicalRetriever: request =>
          new LocalLexicalRetriever({
            ...request,
            candidateLimit: request.limit,
            textStore: textSearch,
            removalReader: storage,
          }),
        createVectorRetriever: request =>
          request.chunks.length > 500
            ? new PagedVectorRetriever({
                request,
                database,
                embeddings,
                options,
              })
            : vectors.asRetriever({
                k: request.limit,
                filter: { ...request.filters, candidates: request.chunks },
              }),
      }).searchHits(query, { signal: options.signal });
    },
  };
}

export async function openLocalE5RagService(): Promise<LocalE5RagService> {
  return createLocalE5RagService(await openLocalAgentMemoryDatabase());
}
