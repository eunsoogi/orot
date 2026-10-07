import type { EvidenceChunk } from './chunking';
import type { LocalFullTextSearchStore } from './localTextSearch';
import type { DocumentQueryEmbeddingProvider, LocalEmbeddingRequest } from './localEmbeddings';
import { LocalEmbeddingJobError } from './localEmbeddings';
import type { LocalEmbeddingVectorStore } from './embeddingRetrieval';
import { searchEvidenceChunks } from './embeddingRetrieval';
import type { EvidenceSearchFilters } from './retrievalFilters';
import { filterEvidenceChunks } from './retrievalFilters';

export interface HybridSearchRankingConfig {
  readonly lexicalWeight: number;
  readonly vectorWeight: number;
  readonly rrfConstant: number;
  readonly candidateLimit: number;
}

export const DEFAULT_HYBRID_SEARCH_RANKING: HybridSearchRankingConfig = {
  lexicalWeight: 0.5,
  vectorWeight: 0.5,
  rrfConstant: 60,
  candidateLimit: 20,
};

export interface HybridEvidenceSearchHit {
  readonly chunk: EvidenceChunk;
  readonly score: number;
  readonly lexicalRank: number | null;
  readonly vectorRank: number | null;
}

export interface HybridSearchOptions extends Omit<LocalEmbeddingRequest, 'input'> {
  readonly filters?: EvidenceSearchFilters;
  readonly ranking?: Partial<HybridSearchRankingConfig>;
}

function resolveRanking(overrides?: Partial<HybridSearchRankingConfig>): HybridSearchRankingConfig {
  const config = { ...DEFAULT_HYBRID_SEARCH_RANKING, ...overrides };
  if (
    !Number.isFinite(config.lexicalWeight) ||
    config.lexicalWeight < 0 ||
    !Number.isFinite(config.vectorWeight) ||
    config.vectorWeight < 0 ||
    config.lexicalWeight + config.vectorWeight === 0 ||
    !Number.isFinite(config.rrfConstant) ||
    config.rrfConstant < 0 ||
    !Number.isInteger(config.candidateLimit) ||
    config.candidateLimit < 1 ||
    config.candidateLimit > 500
  ) {
    throw new LocalEmbeddingJobError('invalid_request', 'Hybrid ranking configuration is invalid.');
  }
  return config;
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Combines ranked local candidates while retaining the source chunk and its evidence locator. */
export async function searchHybridEvidenceChunks(
  query: string,
  chunks: readonly EvidenceChunk[],
  provider: DocumentQueryEmbeddingProvider,
  vectorStore: LocalEmbeddingVectorStore,
  textStore: LocalFullTextSearchStore,
  limit = 5,
  options: HybridSearchOptions = {},
): Promise<readonly HybridEvidenceSearchHit[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new LocalEmbeddingJobError(
      'invalid_request',
      'Search result count must be an integer from 1 to 500.',
    );
  }
  const ranking = resolveRanking(options.ranking);
  const eligibleChunks = filterEvidenceChunks(chunks, options.filters);
  const chunksById = new Map<string, EvidenceChunk>();
  for (const chunk of eligibleChunks) {
    if (!chunk.id || !chunk.text.trim() || chunksById.has(chunk.id)) {
      throw new LocalEmbeddingJobError(
        'invalid_request',
        'Evidence chunks need unique IDs and non-empty text.',
      );
    }
    chunksById.set(chunk.id, chunk);
  }
  if (!query.trim() || chunksById.size === 0) return [];

  // A resumed workflow can retain chunks from before deletion; fence them before either search path.
  // A structured chunk without provenance uses its record ID as sourceId, not a source_records key.
  const rootSourceRecordIds = [
    ...new Set(
      eligibleChunks
        .filter((chunk) => chunk.metadata.sourceRecordIds.includes(chunk.metadata.sourceId))
        .map((chunk) => chunk.metadata.sourceId),
    ),
  ];
  const removed = await vectorStore.findRemovedEvidence(
    [
      ...new Set(
        eligibleChunks.flatMap((chunk) => [
          chunk.metadata.sourceId,
          ...chunk.metadata.sourceRecordIds,
        ]),
      ),
    ],
    [...chunksById.keys()],
    rootSourceRecordIds,
  );
  const removedSourceIds = new Set(removed.sourceRecordIds);
  const removedChunkIds = new Set(removed.chunkIds);
  const searchableChunks = eligibleChunks.filter(
    (chunk) =>
      !removedChunkIds.has(chunk.id) &&
      ![chunk.metadata.sourceId, ...chunk.metadata.sourceRecordIds].some((sourceId) =>
        removedSourceIds.has(sourceId),
      ),
  );
  if (searchableChunks.length === 0) return [];

  const candidateLimit = Math.max(limit, ranking.candidateLimit);
  const [lexicalMatches, vectorHits] = await Promise.all([
    textStore.search(query, searchableChunks, candidateLimit, options.signal),
    searchEvidenceChunks(query, searchableChunks, provider, vectorStore, candidateLimit, {
      signal: options.signal,
      onProgress: options.onProgress,
    }),
  ]);

  const ranks = new Map<string, { lexicalRank: number | null; vectorRank: number | null }>();
  const rankFor = (chunkId: string) => {
    let value = ranks.get(chunkId);
    if (!value) {
      value = { lexicalRank: null, vectorRank: null };
      ranks.set(chunkId, value);
    }
    return value;
  };
  lexicalMatches.forEach(({ chunkId }, index) => {
    if (!chunksById.has(chunkId)) return;
    const rank = rankFor(chunkId);
    if (rank.lexicalRank === null) rank.lexicalRank = index + 1;
  });
  vectorHits.forEach(({ chunk }, index) => {
    const rank = rankFor(chunk.id);
    if (rank.vectorRank === null) rank.vectorRank = index + 1;
  });

  return [...ranks.entries()]
    .map(([chunkId, rank]): HybridEvidenceSearchHit => ({
      chunk: chunksById.get(chunkId)!,
      score:
        (rank.lexicalRank === null
          ? 0
          : ranking.lexicalWeight / (ranking.rrfConstant + rank.lexicalRank)) +
        (rank.vectorRank === null
          ? 0
          : ranking.vectorWeight / (ranking.rrfConstant + rank.vectorRank)),
      ...rank,
    }))
    .sort((left, right) => right.score - left.score || compareIds(left.chunk.id, right.chunk.id))
    .slice(0, limit);
}
