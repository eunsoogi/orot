import { BaseRetriever } from '@langchain/core/retrievers';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';
import { HybridRetriever, evidenceChunkToDocument } from '../src';
import type {
  EvidenceChunk,
  HybridSearchOptions,
  LocalEmbeddingModelIdentity,
  LocalEmbeddingVectorStore,
  LocalFullTextSearchStore,
} from '../src';
import { cosineSimilarity } from './cosineSimilarity';

export type FixtureEmbeddings = EmbeddingsInterface & {
  readonly modelIdentity: LocalEmbeddingModelIdentity;
};

/** Fixture children expose standard retrievers; fusion and deletion guards run in production code. */
class FixtureRetriever extends BaseRetriever {
  lc_namespace = ['orot', 'test'];
  constructor(
    private readonly retrieve: (
      query: string,
    ) => Promise<ReturnType<typeof evidenceChunkToDocument>[]>,
  ) {
    super();
  }
  async _getRelevantDocuments(query: string) {
    return this.retrieve(query);
  }
}

export async function searchFixtureEvidence(
  query: string,
  chunks: readonly EvidenceChunk[],
  embeddings: FixtureEmbeddings,
  vectors: LocalEmbeddingVectorStore,
  text: LocalFullTextSearchStore,
  limit = 5,
  options: HybridSearchOptions = {},
) {
  return new HybridRetriever({
    chunks,
    limit,
    filters: options.filters,
    ranking: options.ranking,
    removalReader: vectors,
    createLexicalRetriever: (request) =>
      new FixtureRetriever(async (value) => {
        const matches = await text.search(value, request.chunks, request.limit, options.signal);
        const byId = new Map(request.chunks.map((chunk) => [chunk.id, chunk]));
        return matches.flatMap((match) => {
          const chunk = byId.get(match.chunkId);
          return chunk ? [evidenceChunkToDocument(chunk)] : [];
        });
      }),
    createVectorRetriever: (request) =>
      new FixtureRetriever(async (value) => {
        const queryVector = await embeddings.embedQuery(value);
        const entries = await vectors.listForModel(
          embeddings.modelIdentity,
          request.chunks.map((chunk) => chunk.id),
        );
        const byId = new Map(entries.map((entry) => [entry.chunkId, entry.vector]));
        return request.chunks
          .flatMap((chunk) => {
            const vector = byId.get(chunk.id);
            if (!vector) return [];
            const score = cosineSimilarity(queryVector, vector);
            return Number.isFinite(score) ? [{ chunk, score }] : [];
          })
          .sort(
            (a, b) =>
              b.score - a.score || (a.chunk.id < b.chunk.id ? -1 : a.chunk.id > b.chunk.id ? 1 : 0),
          )
          .slice(0, request.limit)
          .map((hit) => evidenceChunkToDocument(hit.chunk));
      }),
  }).searchHits(query, { signal: options.signal });
}
