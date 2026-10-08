import {
  clearEvidenceIndex,
  deleteEvidenceChunks,
  indexEvidenceChunks,
  searchEvidenceChunks,
} from '../src/embeddingRetrieval';
import { LOCAL_EMBEDDING_IDENTITY } from '../src/localEmbeddings';
import type { DocumentQueryEmbeddingProvider, LocalEmbeddingResult } from '../src/localEmbeddings';
import type { EvidenceChunk } from '../src/chunking';
import type { LocalEmbeddingVectorStore, LocalEmbeddingWrite } from '../src/embeddingRetrieval';

function vector(first: number, second = 0): number[] {
  const result = Array.from({ length: 384 }, () => 0);
  result[0] = first;
  result[1] = second;
  return result;
}

function chunk(id: string, text: string, sourceRecordIds: readonly string[] = [id]): EvidenceChunk {
  return {
    id,
    text,
    metadata: {
      sourceId: sourceRecordIds[0] ?? id,
      sourceRecordIds,
      evidenceId: id,
      evidenceLocator: { kind: 'structured_record', recordId: id },
      effectiveTime: null,
      recordType: 'symptom_entry',
      reviewState: { status: 'unreviewed' },
    },
  };
}

function success<T>(value: T): LocalEmbeddingResult<T> {
  return { ok: true, value };
}

function makeProvider(): DocumentQueryEmbeddingProvider {
  return {
    modelIdentity: LOCAL_EMBEDDING_IDENTITY,
    embedDocuments: jest.fn(async ({ input, onProgress }) => {
      onProgress?.({
        stage: 'embedding',
        role: 'document',
        completed: input.length,
        total: input.length,
      });
      return success({
        vectors: input.map((_, index) => vector(index === 0 ? 1 : 0, index === 0 ? 0 : 1)),
      });
    }),
    embedQueries: jest.fn(async () => success({ vectors: [vector(1)] })),
  };
}

function makeStore(): LocalEmbeddingVectorStore & {
  records: Map<string, readonly number[]>;
  batches: LocalEmbeddingWrite[][];
  removedChunkIds: Set<string>;
  removedSourceIds: Set<string>;
} {
  const records = new Map<string, readonly number[]>();
  const recordSources = new Map<string, readonly string[]>();
  const batches: LocalEmbeddingWrite[][] = [];
  const removedChunkIds = new Set<string>();
  const removedSourceIds = new Set<string>();
  return {
    records,
    batches,
    removedChunkIds,
    removedSourceIds,
    async upsertBatch(_model, entries) {
      batches.push([...entries]);
      if (
        entries.some(
          (entry) =>
            removedChunkIds.has(entry.chunkId) ||
            entry.sourceRecordIds.some((sourceId) => removedSourceIds.has(sourceId)),
        )
      ) {
        throw new Error('Removed evidence cannot be indexed again.');
      }
      for (const entry of entries) {
        records.set(entry.chunkId, entry.vector);
        recordSources.set(entry.chunkId, entry.sourceRecordIds);
      }
    },
    async listForModel() {
      return [...records].map(([chunkId, value]) => ({ chunkId, vector: value }));
    },
    async deleteEvidence(sourceRecordIds, chunkIds) {
      const sourceIds = new Set(sourceRecordIds);
      for (const sourceRecordId of sourceIds) removedSourceIds.add(sourceRecordId);
      const chunksToRemove = new Set([
        ...chunkIds,
        ...[...recordSources.entries()]
          .filter(([, sources]) => sources.some((sourceId) => sourceIds.has(sourceId)))
          .map(([chunkId]) => chunkId),
      ]);
      for (const chunkId of chunksToRemove) {
        records.delete(chunkId);
        recordSources.delete(chunkId);
        removedChunkIds.add(chunkId);
      }
    },
    async clear(sourceRecordIds = []) {
      for (const sourceRecordId of sourceRecordIds) removedSourceIds.add(sourceRecordId);
      for (const chunkId of records.keys()) removedChunkIds.add(chunkId);
      records.clear();
      recordSources.clear();
    },
    async findRemovedEvidence(sourceRecordIds, chunkIds) {
      return {
        sourceRecordIds: sourceRecordIds.filter((id) => removedSourceIds.has(id)),
        chunkIds: chunkIds.filter((id) => removedChunkIds.has(id)),
      };
    },
  };
}

describe('RAG embedding index and retrieval', () => {
  it('persists document batches with model identity and reports embedding then persistence', async () => {
    const provider = makeProvider();
    const store = makeStore();
    const progress: string[] = [];
    const chunks = [chunk('a', '혈압 기록'), chunk('b', '수면 기록'), chunk('c', '복용 기록')];

    await indexEvidenceChunks(chunks, provider, store, {
      batchSize: 2,
      onProgress: (value) => progress.push(value.stage),
    });

    expect(provider.embedDocuments).toHaveBeenCalledTimes(2);
    expect(provider.embedQueries).not.toHaveBeenCalled();
    expect(store.batches).toHaveLength(2);
    expect(store.records.size).toBe(3);
    expect(progress).toEqual(['embedding', 'persisting', 'embedding', 'persisting']);
  });

  it('embeds the query and ranks only matching persisted model vectors', async () => {
    const provider = makeProvider();
    const store = makeStore();
    const relevant = chunk('a', '혈압 기록은 오전 8시입니다.');
    const distractor = chunk('b', '수면 시간은 7시간입니다.');
    await store.upsertBatch(LOCAL_EMBEDDING_IDENTITY, [
      {
        chunkId: relevant.id,
        vector: vector(1),
        sourceRecordIds: relevant.metadata.sourceRecordIds,
      },
      {
        chunkId: distractor.id,
        vector: vector(0, 1),
        sourceRecordIds: distractor.metadata.sourceRecordIds,
      },
    ]);

    const results = await searchEvidenceChunks(
      '혈압 기록 시각은?',
      [relevant, distractor],
      provider,
      store,
      1,
    );

    expect(provider.embedQueries).toHaveBeenCalledWith({ input: ['혈압 기록 시각은?'] });
    expect(provider.embedDocuments).not.toHaveBeenCalled();
    expect(results.map((hit) => hit.chunk.id)).toEqual(['a']);
    expect(results[0].score).toBeCloseTo(1);
  });

  it('rejects duplicate logical chunk IDs before embedding', async () => {
    const provider = makeProvider();
    await expect(
      indexEvidenceChunks([chunk('same', '하나'), chunk('same', '둘')], provider, makeStore()),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    expect(provider.embedDocuments).not.toHaveBeenCalled();
  });

  it('deletes affected vectors and fences them against graph re-indexing', async () => {
    const provider = makeProvider();
    const store = makeStore();
    const removed = chunk('removed-source', '합성 출처');
    const retained = chunk('retained-source', '다른 합성 출처');
    await indexEvidenceChunks([removed, retained], provider, store);

    await deleteEvidenceChunks([removed], store);
    const results = await searchEvidenceChunks('질문', [removed, retained], provider, store);

    expect(results.map((hit) => hit.chunk.id)).toEqual([retained.id]);
    const rebuilt = chunk('new-chunk-id', '재개된 합성 출처', ['removed-source']);
    await expect(indexEvidenceChunks([rebuilt], provider, store)).rejects.toThrow(
      'Removed evidence cannot be indexed again.',
    );
  });

  it('removes stored chunks from source identifiers without caller-reconstructed chunks', async () => {
    const provider = makeProvider();
    const store = makeStore();
    const original = chunk('stored-chunk', '합성 출처 기록', ['removed-source']);
    await indexEvidenceChunks([original], provider, store);

    await deleteEvidenceChunks([], store, ['removed-source']);

    expect(await searchEvidenceChunks('질문', [original], provider, store)).toEqual([]);
    await expect(
      indexEvidenceChunks(
        [chunk('rebuilt-chunk', '재구성된 합성 출처', ['removed-source'])],
        provider,
        store,
      ),
    ).rejects.toThrow('Removed evidence cannot be indexed again.');
  });

  it('clears every vector while keeping deletion fences for the old index', async () => {
    const provider = makeProvider();
    const store = makeStore();
    const indexed = chunk('old-source', '합성 기록');
    await indexEvidenceChunks([indexed], provider, store);

    await clearEvidenceIndex(store);

    expect(await searchEvidenceChunks('질문', [indexed], provider, store)).toEqual([]);
    await expect(indexEvidenceChunks([indexed], provider, store)).rejects.toThrow(
      'Removed evidence cannot be indexed again.',
    );
  });
});
