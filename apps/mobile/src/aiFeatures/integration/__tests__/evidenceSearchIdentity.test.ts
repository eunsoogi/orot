import { chunkStructuredRecord, searchHybridEvidenceChunks } from '@orot/rag';
import type {
  DocumentQueryEmbeddingProvider,
  LocalEmbeddingModelIdentity,
  LocalEmbeddingVectorStore,
} from '@orot/rag';
import type { LocalFullTextSearchStore } from '@orot/rag';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { buildPersonalEvidence } from '../personalEvidence';
import { createPrivateEvidenceRag } from '../privateEvidenceRag';
import {
  healthObservation,
  inventory,
  noStaleEvidence,
  repository,
  sourceRecord,
} from '../testSupport/personalEvidenceTestSupport';

describe('personal evidence semantic search identity', () => {
  it('matches persisted E5 vectors when lexical search has no results', async () => {
    const source = sourceRecord('source-vector');
    const observation = healthObservation('observation-vector', [
      'source-vector',
    ]);
    const persisted = chunkStructuredRecord(
      'health_observation',
      observation.record as never,
    );
    const records = [source, observation];
    const registry = new LocalEvidenceReferenceRegistry();
    const result = buildPersonalEvidence({
      inventory: inventory(records),
      persistedChunks: [persisted],
      repository: repository(records),
      registry,
      loadCurrentPersistedChunks: async () => [persisted],
      ...noStaleEvidence,
    });
    const identity: LocalEmbeddingModelIdentity = {
      id: 'fixture-e5',
      revision: 'fixture-revision',
      dimension: 1,
      modelSha256: 'model-hash',
      tokenizerSha256: 'tokenizer-hash',
    };
    const provider: DocumentQueryEmbeddingProvider = {
      modelIdentity: identity,
      embedDocuments: jest.fn(async () => ({
        ok: true as const,
        value: { vectors: [[1]] },
      })),
      embedQueries: jest.fn(async () => ({
        ok: true as const,
        value: { vectors: [[1]] },
      })),
    };
    const vectors: LocalEmbeddingVectorStore = {
      // Match the SQLCipher guard: a claimed root source must exist in local storage.
      deleteEvidence: jest.fn(async () => undefined),
      clear: jest.fn(async () => undefined),
      findRemovedEvidence: jest.fn(async (_ids, _chunks, roots) => ({
        sourceRecordIds: roots.filter(id => id !== source.record.id),
        chunkIds: [],
      })),
      upsertBatch: jest.fn(async () => undefined),
      listForModel: jest.fn(async () => [
        { chunkId: persisted.id, vector: [1] },
      ]),
    };
    const lexical: LocalFullTextSearchStore = {
      search: jest.fn(async () => []),
    };
    const rag = createPrivateEvidenceRag(
      {
        index: async () => undefined,
        search: (query, chunks, limit, options) =>
          searchHybridEvidenceChunks(
            query,
            chunks,
            provider,
            vectors,
            lexical,
            limit,
            options,
          ),
      },
      registry,
    );
    const hits = await rag.search(
      'words absent from the record',
      result.chunks,
      5,
    );

    expect(hits.map(hit => hit.chunk.metadata.evidenceId)).toEqual([
      result.items[0]?.evidenceId,
    ]);
  });
});
