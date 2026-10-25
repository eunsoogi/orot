import type { EmbeddingsInterface } from '@langchain/core/embeddings';
import { LOCAL_EMBEDDING_IDENTITY, runLocalEmbeddingJob } from '@orot/rag';
import type {
  LocalEmbeddingBackend,
  LocalEmbeddingRole,
  LocalEmbeddingRunOptions,
} from '@orot/rag';

/**
 * Exposes the existing E5 job as LangChain embeddings without changing native
 * role prefixes or vector validation. The standard interface has no cancellation
 * or progress arguments; the optional second argument retains those per-job
 * controls for callers using this concrete adapter.
 */
export class LocalE5Embeddings implements EmbeddingsInterface {
  readonly modelIdentity = LOCAL_EMBEDDING_IDENTITY;

  constructor(private readonly backend: LocalEmbeddingBackend) {}

  embedDocuments(
    documents: string[],
    options: LocalEmbeddingRunOptions = {},
  ): Promise<number[][]> {
    return this.embed(documents, 'document', options);
  }

  async embedQuery(
    query: string,
    options: LocalEmbeddingRunOptions = {},
  ): Promise<number[]> {
    const [vector] = await this.embed([query], 'query', options);
    return vector;
  }

  private async embed(
    input: string[],
    role: LocalEmbeddingRole,
    options: LocalEmbeddingRunOptions,
  ): Promise<number[][]> {
    // Leave errors (including AbortError), batching and progress with the shared
    // runner. Copy only at the API boundary to return LangChain's mutable arrays.
    const result = await runLocalEmbeddingJob(this.backend, input, role, options);
    return result.vectors.map(vector => Array.from(vector));
  }
}
