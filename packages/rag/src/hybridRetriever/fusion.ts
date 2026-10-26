import type { DocumentInterface } from '@langchain/core/documents';
import type { EvidenceChunk } from '../chunking';
import {
  DEFAULT_HYBRID_SEARCH_RANKING,
  type HybridEvidenceSearchHit,
  type HybridSearchRankingConfig,
} from '../hybridRetrieval';
import { LocalEmbeddingJobError } from '../localEmbeddings';

export function boundedCount(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 500) {
    throw new LocalEmbeddingJobError(
      'invalid_request',
      'Result counts must be integers from 1 to 500.',
    );
  }
  return value;
}

export function resolveRanking(overrides?: Partial<HybridSearchRankingConfig>) {
  const config = { ...DEFAULT_HYBRID_SEARCH_RANKING, ...overrides };
  boundedCount(config.candidateLimit);
  if (
    !Number.isFinite(config.lexicalWeight) ||
    config.lexicalWeight < 0 ||
    !Number.isFinite(config.vectorWeight) ||
    config.vectorWeight < 0 ||
    config.lexicalWeight + config.vectorWeight === 0 ||
    !Number.isFinite(config.rrfConstant) ||
    config.rrfConstant < 0
  ) {
    throw new LocalEmbeddingJobError('invalid_request', 'Hybrid ranking configuration is invalid.');
  }
  return config;
}

/** Compare JSON-shaped metadata independently of object property insertion order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value) ?? 'undefined';
}

/** Preserve local weighted RRF and ID ties; child scores never change relevance weights. */
export function fuseDocuments(
  chunks: readonly EvidenceChunk[],
  lexical: readonly DocumentInterface[],
  vector: readonly DocumentInterface[],
  config: HybridSearchRankingConfig,
  candidateLimit: number,
  limit: number,
): HybridEvidenceSearchHit[] {
  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const ranks = new Map<string, { lexicalRank: number | null; vectorRank: number | null }>();
  const addRanks = (documents: readonly DocumentInterface[], key: 'lexicalRank' | 'vectorRank') => {
    documents.slice(0, candidateLimit).forEach((document, index) => {
      const chunk = document.id === undefined ? undefined : byId.get(document.id);
      // Never attach a stale document's rank to a corrected chunk with the same ID.
      // Out-of-page and filtered results cannot reintroduce excluded evidence.
      if (
        !chunk ||
        document.pageContent !== chunk.text ||
        canonical(document.metadata) !== canonical(chunk.metadata)
      )
        return;
      let rank = ranks.get(chunk.id);
      if (!rank) {
        rank = { lexicalRank: null, vectorRank: null };
        ranks.set(chunk.id, rank);
      }
      if (rank[key] === null) rank[key] = index + 1;
    });
  };
  addRanks(lexical, 'lexicalRank');
  addRanks(vector, 'vectorRank');
  return [...ranks]
    .map(([id, rank]) => ({
      chunk: byId.get(id)!,
      ...rank,
      score:
        (rank.lexicalRank === null
          ? 0
          : config.lexicalWeight / (config.rrfConstant + rank.lexicalRank)) +
        (rank.vectorRank === null
          ? 0
          : config.vectorWeight / (config.rrfConstant + rank.vectorRank)),
    }))
    .sort(
      (a, b) =>
        b.score - a.score || (a.chunk.id < b.chunk.id ? -1 : a.chunk.id > b.chunk.id ? 1 : 0),
    )
    .slice(0, limit);
}
