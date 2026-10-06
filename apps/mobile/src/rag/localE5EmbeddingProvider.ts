import type {
  EmbeddingProvider,
  EmbeddingRequest,
  EmbeddingResponse,
  ProviderError,
  ProviderErrorCode,
  ProviderResult,
} from '@orot/model-runtime';
import {
  LOCAL_EMBEDDING_IDENTITY,
  LocalEmbeddingJobError,
  runLocalEmbeddingJob,
} from '@orot/rag';
import type {
  DocumentQueryEmbeddingProvider,
  LocalEmbeddingBackend,
  LocalEmbeddingFailure,
  LocalEmbeddingModelIdentity,
  LocalEmbeddingRequest,
  LocalEmbeddingRunOptions,
  LocalEmbeddingResponse,
  LocalEmbeddingResult,
} from '@orot/rag';

const PROVIDER_ERROR_CODES = new Set<ProviderErrorCode>([
  'authentication_required',
  'credential_unavailable',
  'duplicate_provider',
  'internal_error',
  'invalid_provider',
  'invalid_request',
  'provider_unavailable',
  'rate_limited',
  'unsupported_capability',
  'unsupported_input',
]);

function localFailure(error: unknown): LocalEmbeddingFailure {
  if (error instanceof LocalEmbeddingJobError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }
  return {
    code: 'provider_unavailable',
    message:
      error instanceof Error
        ? error.message
        : 'The local embedding runtime failed.',
    retryable: true,
  };
}

function providerResult(
  result: LocalEmbeddingResult<LocalEmbeddingResponse>,
): ProviderResult<EmbeddingResponse> {
  if (result.ok) return result;
  const code = PROVIDER_ERROR_CODES.has(result.error.code as ProviderErrorCode)
    ? (result.error.code as ProviderErrorCode)
    : 'provider_unavailable';
  const error: ProviderError = {
    code,
    message: result.error.message,
    retryable: result.error.retryable,
  };
  return { ok: false, error };
}

// Adapts the pinned local model to the shared provider contract while retaining E5's explicit RAG roles.
export class LocalE5EmbeddingProvider
  implements EmbeddingProvider, DocumentQueryEmbeddingProvider
{
  readonly kind = 'embedding' as const;
  readonly id = 'orot.local.multilingual-e5-small';
  readonly displayName = 'Multilingual E5 Small (on device)';
  readonly capabilities = { inputTypes: ['text'] as const };
  readonly modelIdentity: LocalEmbeddingModelIdentity =
    LOCAL_EMBEDDING_IDENTITY;

  constructor(private readonly backend: LocalEmbeddingBackend) {}

  async embed(
    request: EmbeddingRequest,
  ): Promise<ProviderResult<EmbeddingResponse>> {
    return providerResult(await this.run(request.input, 'document', {}));
  }

  embedDocuments(
    request: LocalEmbeddingRequest,
  ): Promise<LocalEmbeddingResult<LocalEmbeddingResponse>> {
    return this.run(request.input, 'document', request);
  }

  embedQueries(
    request: LocalEmbeddingRequest,
  ): Promise<LocalEmbeddingResult<LocalEmbeddingResponse>> {
    return this.run(request.input, 'query', request);
  }

  private async run(
    input: readonly string[],
    role: 'document' | 'query',
    request: LocalEmbeddingRunOptions,
  ): Promise<LocalEmbeddingResult<LocalEmbeddingResponse>> {
    try {
      return {
        ok: true,
        value: await runLocalEmbeddingJob(this.backend, input, role, request),
      };
    } catch (error) {
      return { ok: false, error: localFailure(error) };
    }
  }
}
