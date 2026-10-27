'use strict';

const { indexEvidenceChunks, searchHybridEvidenceChunks } = require('@orot/rag');

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
  const embed = async ({ input }) => ({
    ok: true,
    value: { vectors: input.map(vectorFor) },
  });
  return {
    modelIdentity: MODEL_IDENTITY,
    embed,
    embedDocuments: embed,
    embedQueries: embed,
  };
}

/** Uses the production hybrid index/search functions over fixture-local stores. */
function createSyntheticRag(repository, trace) {
  const embeddings = new Map();
  const chunksById = new Map();
  const removedSources = new Set();
  const removedChunks = new Set();
  const embeddingProvider = createSyntheticEmbeddingProvider();

  const vectorStore = {
    async deleteEvidence(sourceIds, chunkIds) {
      sourceIds.forEach((id) => removedSources.add(id));
      chunkIds.forEach((id) => {
        removedChunks.add(id);
        embeddings.delete(id);
      });
    },
    async clear(sourceIds = []) {
      sourceIds.forEach((id) => removedSources.add(id));
      for (const id of embeddings.keys()) removedChunks.add(id);
      embeddings.clear();
    },
    async findRemovedEvidence(sourceIds, chunkIds, rootSourceIds, localRecordIds = []) {
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
          ...new Set([
            ...sourceIds.filter((id) => removedSources.has(id)),
            ...missingRoots.filter(Boolean),
            ...missingRecords.filter(Boolean),
          ]),
        ],
        chunkIds: chunkIds.filter((id) => removedChunks.has(id)),
      };
    },
    async upsertBatch(model, entries) {
      if (model.id !== MODEL_IDENTITY.id || model.revision !== MODEL_IDENTITY.revision) return;
      for (const entry of entries) embeddings.set(entry.chunkId, entry.vector);
    },
    async listForModel(model, chunkIds) {
      if (model.id !== MODEL_IDENTITY.id || model.revision !== MODEL_IDENTITY.revision) return [];
      const requested = chunkIds ? new Set(chunkIds) : null;
      return [...embeddings.entries()]
        .filter(([id]) => requested === null || requested.has(id))
        .map(([chunkId, vector]) => ({ chunkId, vector }));
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
      await indexEvidenceChunks(chunks, embeddingProvider, vectorStore, options);
    },
    async search(query, chunks, limit, options = {}) {
      trace.ragSearchCalls += 1;
      chunks.forEach((chunk) => chunksById.set(chunk.id, chunk));
      return searchHybridEvidenceChunks(
        query,
        chunks,
        embeddingProvider,
        vectorStore,
        textStore,
        limit,
        options,
      );
    },
  };
}

module.exports = {
  createSyntheticEmbeddingProvider,
  createSyntheticRag,
  tokensFor,
  vectorFor,
};
