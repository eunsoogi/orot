export const LOCAL_EMBEDDING_MODEL = {
  id: 'intfloat/multilingual-e5-small',
  revision: '614241f622f53c4eeff9890bdc4f31cfecc418b3',
  dimension: 384,
  modelFile: 'onnx/model.onnx',
  modelBytes: 470268510,
  modelSha256: 'ca456c06b3a9505ddfd9131408916dd79290368331e7d76bb621f1cba6bc8665',
  tokenizerFile: 'onnx/sentencepiece.bpe.model',
  tokenizerBytes: 5069051,
  tokenizerSha256: 'cfc8146abe2a0488e9e2a0c56de7952f7c11ab059eca145a0a727afce0db2865',
} as const;

export type LocalEmbeddingRole = 'document' | 'query';

export interface LocalEmbeddingModelIdentity {
  readonly id: string;
  readonly revision: string;
  readonly dimension: number;
  readonly modelSha256: string;
  readonly tokenizerSha256: string;
}

export const LOCAL_EMBEDDING_IDENTITY: LocalEmbeddingModelIdentity = {
  id: LOCAL_EMBEDDING_MODEL.id,
  revision: LOCAL_EMBEDDING_MODEL.revision,
  dimension: LOCAL_EMBEDDING_MODEL.dimension,
  modelSha256: LOCAL_EMBEDDING_MODEL.modelSha256,
  tokenizerSha256: LOCAL_EMBEDDING_MODEL.tokenizerSha256,
};

export type LocalEmbeddingProgress =
  | {
      readonly stage: 'model_download';
      readonly completed: number;
      readonly total: number;
    }
  | {
      readonly stage: 'embedding';
      readonly role: LocalEmbeddingRole;
      readonly completed: number;
      readonly total: number;
    };

export interface LocalEmbeddingRunOptions {
  readonly batchSize?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: LocalEmbeddingProgress) => void;
}

export interface LocalEmbeddingBackend {
  prepare(requestId: string, onProgress: (completed: number, total: number) => void): Promise<void>;
  embedBatch(
    input: readonly string[],
    role: LocalEmbeddingRole,
    requestId: string,
  ): Promise<readonly (readonly number[])[]>;
  cancel(requestId: string): void;
}

export interface LocalEmbeddingResponse {
  readonly vectors: readonly (readonly number[])[];
}

export interface LocalEmbeddingFailure {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export type LocalEmbeddingResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: LocalEmbeddingFailure };

export interface LocalEmbeddingRequest extends LocalEmbeddingRunOptions {
  readonly input: readonly string[];
}

export interface DocumentQueryEmbeddingProvider {
  readonly modelIdentity: LocalEmbeddingModelIdentity;
  embedDocuments(
    request: LocalEmbeddingRequest,
  ): Promise<LocalEmbeddingResult<LocalEmbeddingResponse>>;
  embedQueries(
    request: LocalEmbeddingRequest,
  ): Promise<LocalEmbeddingResult<LocalEmbeddingResponse>>;
}

export class LocalEmbeddingJobError extends Error {
  constructor(
    readonly code: 'invalid_request' | 'provider_unavailable' | 'internal_error',
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'LocalEmbeddingJobError';
  }
}

let nextRequestNumber = 0;

function createRequestId(): string {
  nextRequestNumber += 1;
  return `orot-embedding-${Date.now()}-${nextRequestNumber}`;
}

function abortError(): Error {
  const error = new Error('Local embedding was cancelled.');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function validateInput(input: readonly string[]): void {
  if (!Array.isArray(input) || input.some((text) => typeof text !== 'string' || !text.trim())) {
    throw new LocalEmbeddingJobError(
      'invalid_request',
      'Embedding input must contain non-empty text.',
    );
  }
}

function validateVectors(vectors: readonly (readonly number[])[], expectedCount: number): void {
  if (vectors.length !== expectedCount) {
    throw new LocalEmbeddingJobError(
      'provider_unavailable',
      'The embedding runtime returned an incomplete batch.',
      true,
    );
  }
  for (const vector of vectors) {
    if (
      vector.length !== LOCAL_EMBEDDING_MODEL.dimension ||
      vector.some((value) => !Number.isFinite(value))
    ) {
      throw new LocalEmbeddingJobError(
        'provider_unavailable',
        'The embedding runtime returned an invalid vector.',
      );
    }
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    if (Math.abs(norm - 1) > 0.002) {
      throw new LocalEmbeddingJobError(
        'provider_unavailable',
        'The embedding runtime returned a non-normalized vector.',
      );
    }
  }
}

// Keeps native inference batches small so cancellation can stop at a predictable boundary.
export async function runLocalEmbeddingJob(
  backend: LocalEmbeddingBackend,
  input: readonly string[],
  role: LocalEmbeddingRole,
  options: LocalEmbeddingRunOptions = {},
): Promise<LocalEmbeddingResponse> {
  validateInput(input);
  if (input.length === 0) return { vectors: [] };
  const batchSize = options.batchSize ?? 4;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 8) {
    throw new LocalEmbeddingJobError(
      'invalid_request',
      'Embedding batch size must be between 1 and 8.',
    );
  }

  const requestId = createRequestId();
  const onAbort = () => backend.cancel(requestId);
  throwIfAborted(options.signal);
  options.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    await backend.prepare(requestId, (completed, total) => {
      options.onProgress?.({ stage: 'model_download', completed, total });
    });
    throwIfAborted(options.signal);

    const vectors: (readonly number[])[] = [];
    for (let offset = 0; offset < input.length; offset += batchSize) {
      throwIfAborted(options.signal);
      const batch = input.slice(offset, offset + batchSize);
      const batchVectors = await backend.embedBatch(batch, role, requestId);
      throwIfAborted(options.signal);
      validateVectors(batchVectors, batch.length);
      vectors.push(...batchVectors);
      options.onProgress?.({
        stage: 'embedding',
        role,
        completed: vectors.length,
        total: input.length,
      });
    }
    return { vectors };
  } catch (error) {
    if (options.signal?.aborted) throw abortError();
    if (error instanceof LocalEmbeddingJobError) throw error;
    throw new LocalEmbeddingJobError(
      'provider_unavailable',
      error instanceof Error ? error.message : 'The local embedding runtime failed.',
      true,
    );
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
  }
}
