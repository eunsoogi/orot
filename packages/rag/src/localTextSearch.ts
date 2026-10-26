import type { EvidenceChunk } from './chunking';

export interface LocalFullTextSearchMatch {
  readonly chunkId: string;
}

export interface LocalFullTextSearchStore {
  // Matches are ordered by lexical relevance and refer back to caller-owned evidence chunks.
  search(
    query: string,
    chunks: readonly EvidenceChunk[],
    limit: number,
    signal?: AbortSignal,
  ): Promise<readonly LocalFullTextSearchMatch[]>;
}
