import { BaseRetriever } from '@langchain/core/retrievers';
import type { BaseRetrieverInput } from '@langchain/core/retrievers';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { Document } from '@langchain/core/documents';
import {
  evidenceChunkToDocument,
  filterEvidenceChunks,
  LocalEmbeddingJobError,
} from '@orot/rag';
import type {
  EvidenceChunk,
  EvidenceChunkMetadata,
  EvidenceSearchFilters,
  LocalFullTextSearchStore,
} from '@orot/rag';
import { eligibleLexicalEvidence } from './lexicalEvidenceEligibility';
import type { EvidenceRemovalReader } from './lexicalEvidenceEligibility';

export interface LocalLexicalRetrieverInput extends BaseRetrieverInput {
  /** A caller-selected candidate page; retrieval never expands it to the corpus. */
  readonly chunks: readonly EvidenceChunk[];
  readonly textStore: LocalFullTextSearchStore;
  /** Rechecks persisted deletion fences for retained pages without computing embeddings. */
  readonly removalReader: EvidenceRemovalReader;
  readonly filters?: EvidenceSearchFilters;
  readonly limit?: number;
  readonly candidateLimit?: number;
}

function boundedCount(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 500) {
    throw new LocalEmbeddingJobError(
      'invalid_request',
      'Lexical result counts must be integers from 1 to 500.',
    );
  }
  return value;
}

function abortIfNeeded(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('Lexical retrieval was cancelled.');
  error.name = 'AbortError';
  throw error;
}

/** Exposes lexical order as LangChain documents without invoking hybrid ranking. */
export class LocalLexicalRetriever extends BaseRetriever<EvidenceChunkMetadata> {
  lc_namespace = ['orot', 'rag', 'retrievers'];
  private signal?: AbortSignal;

  constructor(private readonly input: LocalLexicalRetrieverInput) {
    super(input);
    boundedCount(input.limit ?? 5);
    boundedCount(input.candidateLimit ?? 20);
  }

  override invoke(query: string, options?: RunnableConfig) {
    // BaseRetriever 1.2 does not pass RunnableConfig to _getRelevantDocuments.
    // Bind a separate instance per invocation so concurrent abort signals cannot leak.
    const scoped = new LocalLexicalRetriever(this.input);
    scoped.signal = options?.signal;
    return scoped.invokeWithCallbacks(query, options);
  }

  private invokeWithCallbacks(query: string, options?: RunnableConfig) {
    return super.invoke(query, options);
  }

  override async _getRelevantDocuments(
    query: string,
  ): Promise<Document<EvidenceChunkMetadata>[]> {
    abortIfNeeded(this.signal);
    const limit = this.input.limit ?? 5;
    const candidateLimit = Math.max(limit, this.input.candidateLimit ?? 20);
    const filtered = filterEvidenceChunks(
      this.input.chunks,
      this.input.filters,
    );
    const ids = new Set<string>();
    for (const chunk of filtered) {
      if (!chunk.id || !chunk.text.trim() || ids.has(chunk.id)) {
        throw new LocalEmbeddingJobError(
          'invalid_request',
          'Evidence chunks need unique IDs and non-empty text.',
        );
      }
      ids.add(chunk.id);
    }
    if (!query.trim() || filtered.length === 0) return [];
    const searchable = await eligibleLexicalEvidence(
      filtered,
      this.input.removalReader,
    );
    abortIfNeeded(this.signal);
    if (searchable.length === 0) return [];
    const matches = await this.input.textStore.search(
      query,
      searchable,
      candidateLimit,
      this.signal,
    );
    abortIfNeeded(this.signal);
    const byId = new Map(searchable.map(chunk => [chunk.id, chunk]));
    const documents: Document<EvidenceChunkMetadata>[] = [];
    // Treat store matches as references only: stale, duplicate or out-of-page
    // IDs cannot introduce excluded evidence or exceed the bounded result budget.
    for (const match of matches.slice(0, candidateLimit)) {
      const chunk = byId.get(match.chunkId);
      if (!chunk) continue;
      documents.push(evidenceChunkToDocument(chunk));
      byId.delete(match.chunkId);
      if (documents.length === limit) break;
    }
    return documents;
  }
}
