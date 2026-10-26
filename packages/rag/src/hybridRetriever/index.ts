import { CallbackManager } from '@langchain/core/callbacks/manager';
import { BaseRetriever, type BaseRetrieverInput } from '@langchain/core/retrievers';
import { ensureConfig, type RunnableConfig } from '@langchain/core/runnables';
import { AsyncLocalStorageProviderSingleton } from '@langchain/core/singletons';
import type { EvidenceChunk, EvidenceChunkMetadata } from '../chunking';
import { evidenceChunkToDocument, documentToEvidenceChunk } from '../langchain/documents';
import type { HybridSearchRankingConfig } from '../hybridRetrieval';
import { LocalEmbeddingJobError } from '../localEmbeddings';
import { filterEvidenceChunks, type EvidenceSearchFilters } from '../retrievalFilters';
import {
  callerStreamHandlers,
  eligibleHybridChunks,
  PrivateChildCallbacks,
  type EvidenceRemovalReader,
} from './eligibility';
import { boundedCount, fuseDocuments, resolveRanking } from './fusion';

export interface HybridCandidateRequest {
  readonly chunks: readonly EvidenceChunk[];
  readonly filters?: EvidenceSearchFilters;
  /** Each standard retriever must return this many candidates before fusion. */
  readonly limit: number;
}

export type CandidateRetriever = BaseRetriever;
type EventOptions = RunnableConfig & { version: 'v1' | 'v2'; encoding?: 'text/event-stream' };

export interface HybridRetrieverInput extends BaseRetrieverInput {
  /** Caller-selected page, never an implicit corpus scan. */
  readonly chunks: readonly EvidenceChunk[];
  readonly removalReader: EvidenceRemovalReader;
  /** Return direct standard adapters. Runnable bindings can replace the private callback manager. */
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
  private allowCallerStream = false;

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
    scoped.allowCallerStream = this.allowCallerStream;
    return scoped.retrieveForCaller(query);
  }

  // Clear every incoming observer before the framework installs its direct-consumer handler.
  // Preserve all overloads, including SSE byte output; Parameters<> alone narrows to SSE.
  override streamEvents = ((
    query: string,
    options: EventOptions,
    streamOptions?: Parameters<BaseRetriever['streamEvents']>[2],
  ) => {
    const scoped = new HybridRetriever(this.input);
    scoped.allowCallerStream = true;
    return scoped.callerEvents(
      query,
      {
        ...ensureConfig(options),
        version: options.version,
        encoding: options.encoding,
        callbacks: [],
      },
      streamOptions,
    );
  }) as BaseRetriever<EvidenceChunkMetadata>['streamEvents'];

  private callerEvents(
    query: string,
    options: EventOptions,
    streamOptions?: Parameters<BaseRetriever['streamEvents']>[2],
  ) {
    return super.streamEvents(query, options, streamOptions);
  }

  override streamLog(...[query, options, streamOptions]: Parameters<BaseRetriever['streamLog']>) {
    const scoped = new HybridRetriever(this.input);
    scoped.allowCallerStream = true;
    return scoped.callerLog(query, { ...ensureConfig(options), callbacks: [] }, streamOptions);
  }

  private callerLog(...args: Parameters<BaseRetriever['streamLog']>) {
    return super.streamLog(...args);
  }

  private async retrieveForCaller(query: string) {
    // Bypass BaseRetriever.configure(): even an empty handler list installs ambient tracing.
    const handlers = this.allowCallerStream ? callerStreamHandlers(this.config?.callbacks) : [];
    if (handlers.length === 0) return this._getRelevantDocuments(query);
    const manager = new CallbackManager();
    handlers.forEach((handler) => manager.addHandler(handler));
    manager.addTags(this.tags ?? []);
    manager.addTags(this.config?.tags ?? [], false);
    manager.addMetadata(this.metadata ?? {});
    manager.addMetadata(this.config?.metadata ?? {}, false);
    const run = await manager.handleRetrieverStart(
      this.toJSON(),
      query,
      this.config?.runId,
      undefined,
      undefined,
      undefined,
      this.config?.runName ?? this.getName(),
    );
    try {
      const documents = await this._getRelevantDocuments(query);
      await run.handleRetrieverEnd(documents);
      return documents;
    } catch (error) {
      await run.handleRetrieverError(error);
      throw error;
    }
  }

  private retrieveChild(
    create: HybridRetrieverInput['createLexicalRetriever'],
    request: HybridCandidateRequest,
    query: string,
  ) {
    const config = { ...this.config, callbacks: new PrivateChildCallbacks() };
    // Also replace implicit callbacks so standard descendants cannot reacquire an outer observer.
    return AsyncLocalStorageProviderSingleton.runWithConfig(config, async () => {
      const child = create(request);
      if (!(child instanceof BaseRetriever)) {
        throw new LocalEmbeddingJobError(
          'invalid_request',
          'Hybrid retrieval requires direct standard retriever adapters.',
        );
      }
      return child.invoke(query, config);
    });
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
      this.retrieveChild(this.input.createLexicalRetriever, request, query),
      this.retrieveChild(this.input.createVectorRetriever, request, query),
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
