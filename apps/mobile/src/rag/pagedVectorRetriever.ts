import type { DocumentInterface } from '@langchain/core/documents';
import { BaseRetriever } from '@langchain/core/retrievers';
import { ensureConfig, type RunnableConfig } from '@langchain/core/runnables';
import type {
  HybridCandidateRequest,
  LocalEmbeddingRunOptions,
} from '@orot/rag';
import type { SqlDatabase } from '@orot/storage';
import { LocalE5Embeddings } from './localE5Embeddings';
import { SqlCipherVectorStore } from '../storage/sqlCipherVectorStore';
import { MAX_VECTOR_CANDIDATES } from '../storage/ragVectorStoreEvidence';

interface PagedVectorInput {
  readonly request: HybridCandidateRequest;
  readonly database: SqlDatabase;
  readonly embeddings: LocalE5Embeddings;
  readonly options?: LocalEmbeddingRunOptions;
}

function abortIfNeeded(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('Paged vector retrieval was cancelled.');
  error.name = 'AbortError';
  throw error;
}

/** App-private adapter: keep the VectorStore page contract and return one global vector order. */
export class PagedVectorRetriever extends BaseRetriever {
  lc_namespace = ['orot', 'rag', 'retrievers'];
  private signal?: AbortSignal;

  constructor(private readonly input: PagedVectorInput) {
    super();
  }

  override async invoke(query: string, options?: RunnableConfig) {
    const config = ensureConfig(options);
    // Invocation-local controls preserve inherited deadlines without sharing mutable call state.
    const scoped = new PagedVectorRetriever(this.input);
    scoped.signal = config.signal;
    return scoped.invokeForCaller(query, config);
  }

  private invokeForCaller(query: string, config: RunnableConfig) {
    // HybridRetriever owns this fresh adapter and installs its content-private callback manager.
    return super.invoke(query, config);
  }

  override async _getRelevantDocuments(
    query: string,
  ): Promise<DocumentInterface[]> {
    abortIfNeeded(this.signal);
    const { request, database, embeddings, options } = this.input;
    const vector = await embeddings.embedQuery(query, {
      ...options,
      signal: this.signal,
    });
    abortIfNeeded(this.signal);
    let hits: [DocumentInterface, number][] = [];
    await database.transaction(async transaction => {
      // Every page and its revision/eligibility reads join this one owning transaction.
      // Current production row writers use the same queue; raw SQL exclusivity is not promised.
      const store = new SqlCipherVectorStore(embeddings, {
        execute: (sql, values) => transaction.execute(sql, values),
        transaction: operation => operation(transaction),
      });
      for (
        let offset = 0;
        offset < request.chunks.length;
        offset += MAX_VECTOR_CANDIDATES
      ) {
        abortIfNeeded(this.signal);
        const page = await store.similaritySearchVectorWithScore(
          vector,
          request.limit,
          {
            ...request.filters,
            candidates: request.chunks.slice(
              offset,
              offset + MAX_VECTOR_CANDIDATES,
            ),
          },
        );
        abortIfNeeded(this.signal);
        // Each page filters eligibility/revisions before top-k. Its discarded rows cannot
        // outrank the global kth row. Merge cosine/ID order here, never page-local RRF ranks.
        hits = [...hits, ...page]
          .sort(
            ([left, a], [right, b]) =>
              b - a ||
              (left.id! < right.id! ? -1 : left.id! > right.id! ? 1 : 0),
          )
          .slice(0, request.limit);
      }
    });
    // A failed/aborted later page rejects the operation; no partial result is published.
    // HybridRetriever performs its existing deletion-only fence after this transaction ends.
    abortIfNeeded(this.signal);
    return hits.map(([document]) => document);
  }
}
