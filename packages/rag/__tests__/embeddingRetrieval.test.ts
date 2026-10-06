import { indexEvidenceChunks, searchEvidenceChunks } from '../src/embeddingRetrieval';
import { LOCAL_EMBEDDING_IDENTITY } from '../src/localEmbeddings';
import type { DocumentQueryEmbeddingProvider, LocalEmbeddingResult } from '../src/localEmbeddings';
import type { EvidenceChunk } from '../src/chunking';
import type { LocalEmbeddingVectorStore, PersistedLocalEmbedding } from '../src/embeddingRetrieval';

function vector(first: number, second = 0): number[] {
  const result = Array.from({ length: 384 }, () => 0);
  result[0] = first;
  result[1] = second;
  return result;
}

function chunk(id: string, text: string): EvidenceChunk {
  return {
    id,
    text,
    metadata: {
      sourceId: id,
      sourceRecordIds: [id],
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
  batches: PersistedLocalEmbedding[][];
} {
  const records = new Map<string, readonly number[]>();
  const batches: PersistedLocalEmbedding[][] = [];
  return {
    records,
    batches,
    async upsertBatch(_model, entries) {
      batches.push([...entries]);
      for (const entry of entries) records.set(entry.chunkId, entry.vector);
    },
    async listForModel() {
      return [...records].map(([chunkId, value]) => ({ chunkId, vector: value }));
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
      { chunkId: relevant.id, vector: vector(1) },
      { chunkId: distractor.id, vector: vector(0, 1) },
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
});
