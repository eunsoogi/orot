import type { DocumentInterface } from '@langchain/core/documents';
import { BaseRetriever, type BaseRetrieverInput } from '@langchain/core/retrievers';
import { ensureConfig, type RunnableConfig } from '@langchain/core/runnables';
import type { EvidenceChunk, EvidenceChunkMetadata } from '../chunking';
import { evidenceChunkToDocument, documentToEvidenceChunk } from '../langchain/documents';
import type { HybridSearchRankingConfig } from '../hybridRetrieval';
import { LocalEmbeddingJobError } from '../localEmbeddings';
import { filterEvidenceChunks, type EvidenceSearchFilters } from '../retrievalFilters';
import { eligibleHybridChunks, type EvidenceRemovalReader } from './eligibility';
import { boundedCount, fuseDocuments, resolveRanking } from './fusion';

export interface HybridCandidateRequest {
  readonly chunks: readonly EvidenceChunk[];
  readonly filters?: EvidenceSearchFilters;
  /** Each standard retriever must return this many candidates before fusion. */
  readonly limit: number;
}

export interface CandidateRetriever {
  invoke(query: string, config?: RunnableConfig): Promise<DocumentInterface[]>;
}

export interface HybridRetrieverInput extends BaseRetrieverInput {
  /** Caller-selected page, never an implicit corpus scan. */
  readonly chunks: readonly EvidenceChunk[];
  readonly removalReader: EvidenceRemovalReader;
  /** Factories bind the current page and budget to the app's existing standard adapters. */
  readonly createLexicalRetriever: (request: HybridCandidateRequest) => CandidateRetriever;
  readonly createVectorRetriever: (request: HybridCandidateRequest) => CandidateRetriever;
  readonly filters?: EvidenceSearchFilters;
  readonly limit?: number;
  readonly ranking?: Partial<HybridSearchRankingConfig>;
}

function abortIfNeeded(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('Hybrid retrieval was cancelled.');
  error.name = 'AbortError';
  throw error;
}

/** Compose standard lexical/vector retrievers while keeping evidence metadata opaque and intact. */
export class HybridRetriever extends BaseRetriever<EvidenceChunkMetadata> {
  lc_namespace = ['orot', 'rag', 'retrievers'];
  private config?: RunnableConfig;

  constructor(private readonly input: HybridRetrieverInput) {
    super(input);
    boundedCount(input.limit ?? 5);
    resolveRanking(input.ranking);
    if (input.chunks.length > 500) {
      throw new LocalEmbeddingJobError(
        'invalid_request',
        'Hybrid candidate pages may contain at most 500 chunks.',
      );
    }
  }

  override async invoke(query: string, options?: RunnableConfig) {
    // BaseRetriever does not pass RunnableConfig to _getRelevantDocuments.
    // Scope normalized deadlines/signals per call so concurrent invocations stay independent.
    const scoped = new HybridRetriever(this.input);
    scoped.config = ensureConfig(options);
    return scoped.invokeWithCallbacks(query);
  }

  private invokeWithCallbacks(query: string) {
    return super.invoke(query, this.config);
  }

  override async _getRelevantDocuments(query: string) {
    abortIfNeeded(this.config?.signal);
    // Snapshot before asynchronous child/storage calls; caller mutations cannot mix revisions.
    const chunks = filterEvidenceChunks(
      this.input.chunks.map((chunk) => documentToEvidenceChunk(evidenceChunkToDocument(chunk))),
      this.input.filters,
    );
    const ids = new Set<string>();
    for (const chunk of chunks) {
      if (!chunk.id || !chunk.text.trim() || ids.has(chunk.id)) {
        throw new LocalEmbeddingJobError(
          'invalid_request',
          'Evidence chunks need unique IDs and non-empty text.',
        );
      }
      ids.add(chunk.id);
    }
    if (!query.trim() || chunks.length === 0) return [];
    const searchable = await eligibleHybridChunks(chunks, this.input.removalReader);
    abortIfNeeded(this.config?.signal);
    if (searchable.length === 0) return [];
    const limit = this.input.limit ?? 5;
    const ranking = resolveRanking(this.input.ranking);
    const candidateLimit = Math.max(limit, ranking.candidateLimit);
    const request = { chunks: searchable, filters: this.input.filters, limit: candidateLimit };
    const [lexical, vector] = await Promise.all([
      this.input.createLexicalRetriever(request).invoke(query, this.config),
      this.input.createVectorRetriever(request).invoke(query, this.config),
    ]);
    abortIfNeeded(this.config?.signal);
    // A deletion may commit while a child is retrieving. Fence again before returning citations.
    const retained = await eligibleHybridChunks(searchable, this.input.removalReader);
    abortIfNeeded(this.config?.signal);
    return fuseDocuments(retained, lexical, vector, ranking, candidateLimit, limit).map((hit) =>
      evidenceChunkToDocument(hit.chunk),
    );
  }
}
