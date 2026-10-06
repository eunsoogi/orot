import type { EvidenceChunk } from './chunking';
import type {
  DocumentQueryEmbeddingProvider,
  LocalEmbeddingModelIdentity,
  LocalEmbeddingProgress,
  LocalEmbeddingRequest,
  LocalEmbeddingResult,
} from './localEmbeddings';
import { LocalEmbeddingJobError } from './localEmbeddings';

export interface PersistedLocalEmbedding {
  readonly chunkId: string;
  readonly vector: readonly number[];
}

export interface LocalEmbeddingVectorStore {
  upsertBatch(
    model: LocalEmbeddingModelIdentity,
    entries: readonly PersistedLocalEmbedding[],
    signal?: AbortSignal,
  ): Promise<void>;
  listForModel(model: LocalEmbeddingModelIdentity): Promise<readonly PersistedLocalEmbedding[]>;
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

function abortError(): Error {
  const error = new Error('Local embedding was cancelled.');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function assertSuccessful<T>(result: LocalEmbeddingResult<T>): T {
  if (!result.ok) {
    throw new LocalEmbeddingJobError(
      result.error.code === 'invalid_request' ? 'invalid_request' : 'provider_unavailable',
      result.error.message,
      result.error.retryable,
    );
  }
  return result.value;
}

// Commits one bounded batch at a time so cancellation leaves retryable, model-keyed progress.
export async function indexEvidenceChunks(
  chunks: readonly EvidenceChunk[],
  provider: DocumentQueryEmbeddingProvider,
  store: LocalEmbeddingVectorStore,
  options: EmbeddingIndexOptions = {},
): Promise<void> {
  const batchSize = options.batchSize ?? 4;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 8) {
    throw new LocalEmbeddingJobError(
      'invalid_request',
      'Embedding batch size must be between 1 and 8.',
    );
  }
  const seen = new Set<string>();
  for (const chunk of chunks) {
    if (!chunk.id || !chunk.text.trim() || seen.has(chunk.id)) {
      throw new LocalEmbeddingJobError(
        'invalid_request',
        'Evidence chunks need unique IDs and non-empty text.',
      );
    }
    seen.add(chunk.id);
  }

  for (let offset = 0; offset < chunks.length; offset += batchSize) {
    throwIfAborted(options.signal);
    const batch = chunks.slice(offset, offset + batchSize);
    const result = assertSuccessful(
      await provider.embedDocuments({
        input: batch.map((chunk) => chunk.text),
        batchSize,
        signal: options.signal,
        onProgress: (progress) => {
          options.onProgress?.(mapIndexProgress(progress, offset, chunks.length));
        },
      }),
    );
    if (result.vectors.length !== batch.length) {
      throw new LocalEmbeddingJobError(
        'provider_unavailable',
        'Document embeddings did not match their chunks.',
      );
    }
    throwIfAborted(options.signal);
    await store.upsertBatch(
      provider.modelIdentity,
      batch.map((chunk, index) => ({ chunkId: chunk.id, vector: result.vectors[index] })),
      options.signal,
    );
    options.onProgress?.({
      stage: 'persisting',
      completed: offset + batch.length,
      total: chunks.length,
    });
  }
}

function mapIndexProgress(
  progress: LocalEmbeddingProgress,
  offset: number,
  total: number,
): EmbeddingIndexProgress {
  return progress.stage === 'model_download'
    ? { ...progress, stage: 'model_download' }
    : { stage: 'embedding', completed: offset + progress.completed, total };
}

export interface LocalEmbeddingSearchHit {
  readonly chunk: EvidenceChunk;
  readonly score: number;
}

function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length || left.length === 0) return Number.NEGATIVE_INFINITY;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.NEGATIVE_INFINITY;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return Number.NEGATIVE_INFINITY;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

// Query vectors are transient; only document vectors are written to the encrypted vector store.
export async function searchEvidenceChunks(
  query: string,
  chunks: readonly EvidenceChunk[],
  provider: DocumentQueryEmbeddingProvider,
  store: LocalEmbeddingVectorStore,
  limit = 5,
  options: Omit<LocalEmbeddingRequest, 'input'> = {},
): Promise<readonly LocalEmbeddingSearchHit[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new LocalEmbeddingJobError(
      'invalid_request',
      'Search result count must be a positive integer.',
    );
  }
  const queryResult = assertSuccessful(await provider.embedQueries({ input: [query], ...options }));
  const queryVector = queryResult.vectors[0];
  if (!queryVector || queryVector.length !== provider.modelIdentity.dimension) {
    throw new LocalEmbeddingJobError(
      'provider_unavailable',
      'The query embedding has the wrong dimension.',
    );
  }
  const vectors = await store.listForModel(provider.modelIdentity);
  const vectorByChunkId = new Map(vectors.map((entry) => [entry.chunkId, entry.vector]));
  return chunks
    .flatMap((chunk) => {
      const vector = vectorByChunkId.get(chunk.id);
      if (!vector) return [];
      const score = cosineSimilarity(queryVector, vector);
      return Number.isFinite(score) ? [{ chunk, score }] : [];
    })
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      return left.chunk.id < right.chunk.id ? -1 : left.chunk.id > right.chunk.id ? 1 : 0;
    })
    .slice(0, limit);
}
