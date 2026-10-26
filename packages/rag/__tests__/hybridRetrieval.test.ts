import type { ReviewState } from '@orot/domain';
import {
  DEFAULT_HYBRID_SEARCH_RANKING,
  LOCAL_EMBEDDING_IDENTITY,
  LocalEmbeddingJobError,
  searchHybridEvidenceChunks,
} from '../src';
import type {
  DocumentQueryEmbeddingProvider,
  EvidenceChunk,
  LocalFullTextSearchStore,
  LocalEmbeddingVectorStore,
} from '../src';

function vector(first: number, second = 0): number[] {
  return Array.from({ length: LOCAL_EMBEDDING_IDENTITY.dimension }, (_, index) =>
    index === 0 ? first : index === 1 ? second : 0,
  );
}

function chunk(
  id: string,
  options: {
    effectiveTime?: string | null;
    recordType?: EvidenceChunk['metadata']['recordType'];
    encounterId?: string;
    reviewState?: ReviewState;
    text?: string;
  } = {},
): EvidenceChunk {
  const text = options.text ?? id;
  return {
    id,
    text,
    metadata: {
      sourceId: id,
      sourceRecordIds: [id],
      evidenceId: id,
      evidenceLocator: { kind: 'text_range', startOffset: 0, endOffset: text.length },
      effectiveTime:
        options.effectiveTime === undefined ? '2026-01-02T08:00:00.000Z' : options.effectiveTime,
      recordType: options.recordType ?? 'medication_assertion',
      reviewState: options.reviewState ?? {
        status: 'reviewed',
        reviewerId: 'synthetic-reviewer',
        reviewedAt: '2026-01-02T08:01:00.000Z',
      },
      ...(options.encounterId ? { encounterId: options.encounterId } : {}),
    },
  };
}

function makeProvider(): DocumentQueryEmbeddingProvider {
  return {
    modelIdentity: LOCAL_EMBEDDING_IDENTITY,
    embedDocuments: jest.fn(),
    embedQueries: jest.fn(async () => ({ ok: true as const, value: { vectors: [vector(1)] } })),
  };
}

function makeVectorStore(
  entries: readonly { chunkId: string; vector: number[] }[],
): LocalEmbeddingVectorStore {
  const vectors = new Map(entries.map((entry) => [entry.chunkId, entry]));
  const sourceIdsByChunk = new Map<string, readonly string[]>();
  const removedChunkIds = new Set<string>();
  const removedSourceIds = new Set<string>();

  return {
    async upsertBatch(_model, batch) {
      if (
        batch.some(
          (entry) =>
            removedChunkIds.has(entry.chunkId) ||
            entry.sourceRecordIds.some((sourceId) => removedSourceIds.has(sourceId)),
        )
      ) {
        throw new Error('Removed evidence cannot be indexed again.');
      }
      for (const entry of batch) {
        vectors.set(entry.chunkId, { chunkId: entry.chunkId, vector: entry.vector });
        sourceIdsByChunk.set(entry.chunkId, entry.sourceRecordIds);
      }
    },
    async listForModel() {
      return [...vectors.values()];
    },
    async deleteEvidence(sourceRecordIds, chunkIds) {
      const sourceIds = new Set(sourceRecordIds);
      for (const sourceRecordId of sourceIds) removedSourceIds.add(sourceRecordId);
      const chunksToRemove = new Set([
        ...chunkIds,
        ...[...sourceIdsByChunk.entries()]
          .filter(([, sources]) => sources.some((sourceId) => sourceIds.has(sourceId)))
          .map(([chunkId]) => chunkId),
      ]);
      for (const chunkId of chunksToRemove) {
        vectors.delete(chunkId);
        sourceIdsByChunk.delete(chunkId);
        removedChunkIds.add(chunkId);
      }
    },
    async clear(sourceRecordIds = []) {
      for (const sourceRecordId of sourceRecordIds) removedSourceIds.add(sourceRecordId);
      for (const chunkId of vectors.keys()) removedChunkIds.add(chunkId);
      vectors.clear();
      sourceIdsByChunk.clear();
    },
    async findRemovedEvidence(sourceRecordIds, chunkIds) {
      return {
        sourceRecordIds: sourceRecordIds.filter((id) => removedSourceIds.has(id)),
        chunkIds: chunkIds.filter((id) => removedChunkIds.has(id)),
      };
    },
  };
}

function makeTextStore(ids: readonly string[]): LocalFullTextSearchStore {
  return {
    search: jest.fn(async () => ids.map((chunkId) => ({ chunkId }))),
  };
}

describe('hybrid evidence retrieval', () => {
  it('fuses lexical-only, vector-only, and shared candidates using weighted RRF', async () => {
    const lexicalOnly = chunk('lexical-only');
    const shared = chunk('shared');
    const vectorOnly = chunk('vector-only');
    const provider = makeProvider();
    const vectorStore = makeVectorStore([
      { chunkId: shared.id, vector: vector(1) },
      { chunkId: vectorOnly.id, vector: vector(0.8, 0.6) },
    ]);

    const hits = await searchHybridEvidenceChunks(
      'synthetic medication query',
      [lexicalOnly, shared, vectorOnly],
      provider,
      vectorStore,
      makeTextStore([lexicalOnly.id, shared.id]),
      3,
      { ranking: { lexicalWeight: 5, vectorWeight: 1, rrfConstant: 1, candidateLimit: 3 } },
    );

    expect(hits.map((hit) => hit.chunk.id)).toEqual(['lexical-only', 'shared', 'vector-only']);
    expect(hits.map((hit) => [hit.lexicalRank, hit.vectorRank])).toEqual([
      [1, null],
      [2, 1],
      [null, 2],
    ]);
    expect(hits[0].score).toBeCloseTo(5 / 2);
    expect(hits[1].score).toBeCloseTo(5 / 3 + 1 / 2);
    expect(hits[0].chunk.metadata.evidenceLocator).toEqual({
      kind: 'text_range',
      startOffset: 0,
      endOffset: lexicalOnly.text.length,
    });
  });

  it('applies inclusive time, type, encounter, and review filters before ranking', async () => {
    const matching = chunk('matching', { encounterId: 'encounter-a', text: '복용 기록' });
    const outsideTime = chunk('outside-time', {
      encounterId: 'encounter-a',
      effectiveTime: '2026-01-01T23:59:59.999Z',
    });
    const wrongType = chunk('wrong-type', {
      encounterId: 'encounter-a',
      recordType: 'symptom_entry',
    });
    const wrongEncounter = chunk('wrong-encounter', { encounterId: 'encounter-b' });
    const needsReview = chunk('needs-review', {
      encounterId: 'encounter-a',
      reviewState: { status: 'needs_review', reason: 'synthetic correction' },
    });
    const provider = makeProvider();
    const vectorStore = makeVectorStore([{ chunkId: matching.id, vector: vector(1) }]);
    const textStore = makeTextStore([matching.id]);

    const hits = await searchHybridEvidenceChunks(
      'synthetic medication query',
      [matching, outsideTime, wrongType, wrongEncounter, needsReview],
      provider,
      vectorStore,
      textStore,
      5,
      {
        filters: {
          timeRange: {
            start: '2026-01-02T08:00:00.000Z',
            end: '2026-01-02T08:00:00.000Z',
          },
          recordTypes: ['medication_assertion'],
          encounterId: 'encounter-a',
          reviewStates: ['reviewed'],
        },
      },
    );

    expect(hits.map((hit) => hit.chunk.id)).toEqual(['matching']);
    expect(textStore.search).toHaveBeenCalledWith(
      'synthetic medication query',
      [matching],
      20,
      undefined,
    );
    expect(hits[0].chunk.metadata.reviewState.status).toBe('reviewed');
  });

  it('rejects invalid bounds and unusable ranking weights', async () => {
    const provider = makeProvider();
    const vectorStore = makeVectorStore([]);
    const textStore = makeTextStore([]);
    const chunks = [chunk('one')];

    await expect(
      searchHybridEvidenceChunks('query', chunks, provider, vectorStore, textStore, 5, {
        filters: {
          timeRange: {
            start: '2026-01-03T00:00:00.000Z',
            end: '2026-01-02T00:00:00.000Z',
          },
        },
      }),
    ).rejects.toThrow('The time-range start must not be after its end.');
    await expect(
      searchHybridEvidenceChunks('query', chunks, provider, vectorStore, textStore, 5, {
        ranking: { lexicalWeight: 0, vectorWeight: 0 },
      }),
    ).rejects.toBeInstanceOf(LocalEmbeddingJobError);
  });

  it('exposes explicit defaults and skips both candidate stores for a blank query', async () => {
    const provider = makeProvider();
    const vectorStore = makeVectorStore([]);
    const textStore = makeTextStore([]);

    await expect(
      searchHybridEvidenceChunks('  ', [chunk('one')], provider, vectorStore, textStore),
    ).resolves.toEqual([]);

    expect(DEFAULT_HYBRID_SEARCH_RANKING).toEqual({
      lexicalWeight: 0.5,
      vectorWeight: 0.5,
      rrfConstant: 60,
      candidateLimit: 20,
    });
    expect(provider.embedQueries).not.toHaveBeenCalled();
    expect(textStore.search).not.toHaveBeenCalled();
  });
});
