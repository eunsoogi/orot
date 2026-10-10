import { LOCAL_EMBEDDING_IDENTITY, deleteEvidenceChunks, searchHybridEvidenceChunks } from '../src';
import type {
  DocumentQueryEmbeddingProvider,
  EvidenceChunk,
  LocalEmbeddingVectorStore,
  LocalFullTextSearchStore,
} from '../src';

const removedChunk: EvidenceChunk = {
  id: 'removed-chunk',
  text: '복용 중인 약물에 대한 합성 기록입니다.',
  metadata: {
    sourceId: 'removed-source',
    sourceRecordIds: ['removed-source'],
    evidenceId: 'removed-chunk',
    evidenceLocator: { kind: 'structured_record', recordId: 'removed-chunk' },
    effectiveTime: null,
    recordType: 'medication_assertion',
    reviewState: { status: 'unreviewed' },
  },
};

function makeVectorStore(): LocalEmbeddingVectorStore {
  const removedSources = new Set<string>();
  const removedChunks = new Set<string>();
  const existingSources = new Set(['retained-source']);
  return {
    async deleteEvidence(sourceIds, chunkIds) {
      sourceIds.forEach((id) => removedSources.add(id));
      chunkIds.forEach((id) => removedChunks.add(id));
    },
    async clear(sourceIds = []) {
      sourceIds.forEach((id) => removedSources.add(id));
    },
    async findRemovedEvidence(sourceIds, chunkIds, rootSourceIds = sourceIds) {
      // Provenance can point at transcript revisions that are not source_records rows.
      const missingRootSources = rootSourceIds.filter((id) => !existingSources.has(id));
      return {
        sourceRecordIds: [
          ...new Set([...sourceIds.filter((id) => removedSources.has(id)), ...missingRootSources]),
        ],
        chunkIds: chunkIds.filter((id) => removedChunks.has(id)),
      };
    },
    async upsertBatch() {},
    async listForModel() {
      return [];
    },
  };
}

describe('hybrid evidence deletion', () => {
  it('excludes deleted chunks retained by a resumed workflow before lexical search', async () => {
    const vectorStore = makeVectorStore();
    const textStore: LocalFullTextSearchStore = {
      search: jest.fn(async () => [{ chunkId: removedChunk.id }]),
    };
    const provider: DocumentQueryEmbeddingProvider = {
      modelIdentity: LOCAL_EMBEDDING_IDENTITY,
      embedDocuments: jest.fn(async () => ({ ok: true as const, value: { vectors: [] } })),
      embedQueries: jest.fn(async () => ({
        ok: true as const,
        value: { vectors: [new Array(LOCAL_EMBEDDING_IDENTITY.dimension).fill(0)] },
      })),
    };
    await deleteEvidenceChunks([removedChunk], vectorStore);

    await expect(
      searchHybridEvidenceChunks(
        '복용 약물 기록',
        [removedChunk],
        provider,
        vectorStore,
        textStore,
      ),
    ).resolves.toEqual([]);
    expect(textStore.search).not.toHaveBeenCalled();
    expect(provider.embedQueries).not.toHaveBeenCalled();
  });

  it('keeps a live source searchable when provenance points at a transcript revision', async () => {
    const vectorStore = makeVectorStore();
    const correctedTranscriptChunk: EvidenceChunk = {
      ...removedChunk,
      id: 'corrected-transcript-chunk',
      metadata: {
        ...removedChunk.metadata,
        sourceId: 'retained-source',
        sourceRecordIds: ['transcript-revision-2'],
      },
    };
    const textStore: LocalFullTextSearchStore = {
      search: jest.fn(async () => [{ chunkId: correctedTranscriptChunk.id }]),
    };
    const provider: DocumentQueryEmbeddingProvider = {
      modelIdentity: LOCAL_EMBEDDING_IDENTITY,
      embedDocuments: jest.fn(async () => ({ ok: true as const, value: { vectors: [] } })),
      embedQueries: jest.fn(async () => ({
        ok: true as const,
        value: { vectors: [new Array(LOCAL_EMBEDDING_IDENTITY.dimension).fill(0)] },
      })),
    };

    await expect(
      searchHybridEvidenceChunks(
        '수정된 전사',
        [correctedTranscriptChunk],
        provider,
        vectorStore,
        textStore,
      ),
    ).resolves.toMatchObject([{ chunk: { id: 'corrected-transcript-chunk' } }]);
    expect(textStore.search).toHaveBeenCalledWith(
      '수정된 전사',
      [correctedTranscriptChunk],
      expect.any(Number),
      undefined,
    );
  });

  it('keeps a live manual structured record whose source ID falls back to its record ID', async () => {
    const vectorStore = makeVectorStore();
    const manualChunk: EvidenceChunk = {
      ...removedChunk,
      id: 'manual-encounter-chunk',
      text: '합성 수기 방문 기록입니다.',
      metadata: {
        ...removedChunk.metadata,
        sourceId: 'manual-encounter',
        sourceRecordIds: [],
        evidenceId: 'manual-encounter',
        evidenceLocator: { kind: 'structured_record', recordId: 'manual-encounter' },
        recordType: 'encounter',
      },
    };
    const textStore: LocalFullTextSearchStore = {
      search: jest.fn(async () => [{ chunkId: manualChunk.id }]),
    };
    const provider: DocumentQueryEmbeddingProvider = {
      modelIdentity: LOCAL_EMBEDDING_IDENTITY,
      embedDocuments: jest.fn(async () => ({ ok: true as const, value: { vectors: [] } })),
      embedQueries: jest.fn(async () => ({
        ok: true as const,
        value: { vectors: [new Array(LOCAL_EMBEDDING_IDENTITY.dimension).fill(0)] },
      })),
    };

    await expect(
      searchHybridEvidenceChunks('수기 방문 기록', [manualChunk], provider, vectorStore, textStore),
    ).resolves.toMatchObject([{ chunk: { id: manualChunk.id } }]);
    expect(textStore.search).toHaveBeenCalledWith(
      '수기 방문 기록',
      [manualChunk],
      expect.any(Number),
      undefined,
    );
  });
});
