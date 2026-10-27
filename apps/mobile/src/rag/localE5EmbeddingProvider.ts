import type {
  EmbeddingProvider,
  EmbeddingRequest,
  EmbeddingResponse,
  ProviderResult,
} from '@orot/model-runtime';
import { LOCAL_EMBEDDING_IDENTITY, LocalEmbeddingJobError } from '@orot/rag';
import type { LocalEmbeddingBackend } from '@orot/rag';
import { LocalE5Embeddings } from './localE5Embeddings';

/** Retains Rememori's document API; RAG calls standard embeddings directly. */
export class LocalE5EmbeddingProvider implements EmbeddingProvider {
  readonly modelIdentity = LOCAL_EMBEDDING_IDENTITY;
  readonly kind = 'embedding' as const;
  readonly id = 'orot.local.multilingual-e5-small';
  readonly displayName = 'Multilingual E5 Small (on device)';
  readonly capabilities = { inputTypes: ['text'] as const };
  private readonly embeddings: LocalE5Embeddings;

  constructor(backend: LocalEmbeddingBackend) {
    this.embeddings = new LocalE5Embeddings(backend);
  }

  async embed(
    request: EmbeddingRequest,
  ): Promise<ProviderResult<EmbeddingResponse>> {
    try {
      // Validate the raw request before copying: strings must not become character documents.
      if (!Array.isArray(request.input)) {
        throw new LocalEmbeddingJobError(
          'invalid_request',
          'Embedding input must contain non-empty text.',
        );
      }
      return {
        ok: true,
        value: {
          vectors: await this.embeddings.embedDocuments([...request.input]),
        },
      };
    } catch (error) {
      // Rememori consumes result errors; standard RAG callers retain thrown job errors.
      return {
        ok: false,
        error: {
          code:
            error instanceof LocalEmbeddingJobError
              ? error.code
              : 'provider_unavailable',
          message:
            error instanceof Error
              ? error.message
              : 'The local embedding runtime failed.',
          retryable:
            error instanceof LocalEmbeddingJobError ? error.retryable : true,
        },
      };
    }
  }
}
