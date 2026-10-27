import type { EvidenceChunk } from './chunking';
import type { LocalEmbeddingRunOptions } from './localEmbeddings';
import type { EvidenceSearchFilters } from './retrievalFilters';

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

export interface HybridSearchOptions extends LocalEmbeddingRunOptions {
  readonly filters?: EvidenceSearchFilters;
  readonly ranking?: Partial<HybridSearchRankingConfig>;
}
