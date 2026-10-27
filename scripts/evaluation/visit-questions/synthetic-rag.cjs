'use strict';

const { HybridRetriever, evidenceChunkToDocument } = require('@orot/rag');
const { SyntheticVectorStore, SyntheticLexicalRetriever } = require('./synthetic-retrievers.cjs');

const MODEL_IDENTITY = {
  id: 'orot-synthetic-evaluation-embedding',
  revision: 'fixture-v1',
  dimension: 64,
  modelSha256: 'synthetic-only',
  tokenizerSha256: 'synthetic-only',
};

const QUERY_TERM_ALIASES = {
  다음: ['next'],
  진료: ['appointment', 'visit'],
  // Map the spoken topic to fixture prose; do not treat the internal measurement enum as the topic text.
  수면: ['sleep'],
  복용: ['taking', 'current', 'prescription', 'prescribed', 'current_medication_confirmation'],
  다르면: ['not', 'correction'],
  혈압: ['blood_pressure_systolic', 'blood_pressure_diastolic', 'systolic', 'diastolic'],
};
const KOREAN_PARTICLES = [
  '에서',
  '으로',
  '에게',
  '부터',
  '까지',
  '은',
  '는',
  '이',
  '가',
  '을',
  '를',
  '와',
  '과',
  '에',
  '로',
  '도',
  '만',
  '의',
];

function tokensFor(value) {
  const words = value.toLocaleLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}._:-]*/gu) ?? [];
  // Fixture questions are Korean while snippets are English; retain tokens and add simple particle-free stems for aliases.
  const tokens = words.flatMap((word) => {
    const particle = KOREAN_PARTICLES.find(
      (suffix) => word.length > suffix.length && word.endsWith(suffix),
    );
    return particle && /\p{Script=Hangul}/u.test(word)
      ? [word, word.slice(0, -particle.length)]
      : [word];
  });
  return [...new Set(tokens.flatMap((token) => [token, ...(QUERY_TERM_ALIASES[token] ?? [])]))];
}

/** A deterministic test embedding keeps the shared RAG ranking path offline; it is not quality evidence. */
function vectorFor(value) {
  const vector = Array(MODEL_IDENTITY.dimension).fill(0);
  for (const token of tokensFor(value)) {
    let hash = 2166136261;
    for (const character of token) {
      hash = Math.imul(hash ^ character.codePointAt(0), 16777619);
    }
    vector[(hash >>> 0) % vector.length] += 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, part) => sum + part * part, 0));
  return norm === 0 ? vector : vector.map((part) => part / norm);
}

function createSyntheticEmbeddingProvider() {
  return {
    async embed({ input }) {
      return { ok: true, value: { vectors: input.map(vectorFor) } };
    },
  };
}

/** Uses standard embeddings/vector/retriever APIs with production fusion and deletion guards. */
function createSyntheticRag(repository, trace) {
  const chunksById = new Map();
  const vectors = new SyntheticVectorStore({
    async embedDocuments(input) {
      return input.map(vectorFor);
    },
    async embedQuery(query) {
      return vectorFor(query);
    },
  });

  const removalReader = {
    async findRemovedEvidence(_sourceIds, _chunkIds, rootSourceIds, localRecordIds = []) {
      const missingRoots = await Promise.all(
        rootSourceIds.map(async (id) => ((await repository.get('source_record', id)) ? null : id)),
      );
      const missingRecords = await Promise.all(
        localRecordIds.map(async (id) => {
          const chunk = [...chunksById.values()].find(
            (candidate) => candidate.metadata.evidenceId === id,
          );
          if (!chunk) return id;
          return (await repository.get(chunk.metadata.recordType, id)) ? null : id;
        }),
      );
      return {
        sourceRecordIds: [
          ...new Set([...missingRoots.filter(Boolean), ...missingRecords.filter(Boolean)]),
        ],
        chunkIds: [],
      };
    },
  };

  const textStore = {
    async search(query, chunks, limit, signal) {
      if (signal?.aborted) throw new Error('Synthetic evidence search was cancelled.');
      const queryTokens = new Set(tokensFor(query));
      return chunks
        .map((chunk) => ({
          chunkId: chunk.id,
          score: tokensFor(chunk.text).filter((token) => queryTokens.has(token)).length,
        }))
        .filter((match) => match.score > 0)
        .sort(
          (left, right) => right.score - left.score || left.chunkId.localeCompare(right.chunkId),
        )
        .slice(0, limit)
        .map(({ chunkId }) => ({ chunkId }));
    },
  };

  return {
    async index(chunks, options = {}) {
      trace.ragIndexCalls += 1;
      chunks.forEach((chunk) => chunksById.set(chunk.id, chunk));
      const batchSize = options.batchSize ?? 4;
      if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 8)
        throw new Error('Invalid embedding batch size.');
      const documents = chunks.map(evidenceChunkToDocument);
      if (
        new Set(documents.map((document) => document.id)).size !== documents.length ||
        documents.some((document) => !document.id || !document.pageContent.trim())
      )
        throw new Error('Invalid evidence chunks.');
      for (let offset = 0; offset < documents.length; offset += batchSize) {
        if (options.signal?.aborted) throw new Error('Synthetic evidence indexing was cancelled.');
        await vectors.addDocuments(documents.slice(offset, offset + batchSize));
        options.onProgress?.({
          stage: 'persisting',
          completed: Math.min(offset + batchSize, documents.length),
          total: documents.length,
        });
      }
    },
    async search(query, chunks, limit, options = {}) {
      trace.ragSearchCalls += 1;
      chunks.forEach((chunk) => chunksById.set(chunk.id, chunk));
      return new HybridRetriever({
        chunks,
        limit,
        filters: options.filters,
        ranking: options.ranking,
        removalReader,
        createLexicalRetriever: (request) =>
          new SyntheticLexicalRetriever(request, textStore, options.signal),
        createVectorRetriever: (request) =>
          vectors.asRetriever({ k: request.limit, filter: request.chunks }),
      }).searchHits(query, { signal: options.signal });
    },
  };
}

module.exports = {
  createSyntheticEmbeddingProvider,
  createSyntheticRag,
  tokensFor,
  vectorFor,
};
