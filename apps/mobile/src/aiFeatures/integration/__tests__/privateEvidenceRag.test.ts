import {
  chunkStructuredRecord,
  LOCAL_EMBEDDING_IDENTITY,
  searchHybridEvidenceChunks,
} from '@orot/rag';
import type { DocumentQueryEmbeddingProvider } from '@orot/rag';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { createHealthEvidenceTestDatabase } from '../../../healthEvidence/localEvidenceTestSupport';
import { createLocalHealthEvidenceRepository } from '../../../healthEvidence/localEvidenceRepository';
import { SqlCipherRagEmbeddingStorage } from '../../../storage/ragEmbeddingStorage';
import { createPrivateEvidenceRag } from '../privateEvidenceRag';
import { buildPersonalEvidence } from '../personalEvidence';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import {
  healthObservation,
  inventory,
  noStaleEvidence,
  sourceRecord,
} from '../testSupport/personalEvidenceTestSupport';

test('real SQLite deletion guards accept local identities while returned hits retain opaque aliases', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    const records = createRecordRepository(database);
    const source = sourceRecord('private-source');
    const row = healthObservation('private-observation', ['private-source']);
    await records.put(source.kind, source.record);
    await records.put(row.kind, row.record);
    const persisted = chunkStructuredRecord(
      'health_observation',
      row.record as never,
    );
    const registry = new LocalEvidenceReferenceRegistry();
    const evidence = buildPersonalEvidence({
      inventory: inventory([source, row]),
      persistedChunks: [persisted],
      registry,
      repository: createLocalHealthEvidenceRepository(database),
      loadCurrentPersistedChunks: async () => [persisted],
      ...noStaleEvidence,
    });
    const vectors = new SqlCipherRagEmbeddingStorage(database);
    const provider: DocumentQueryEmbeddingProvider = {
      modelIdentity: LOCAL_EMBEDDING_IDENTITY,
      embedDocuments: async () => ({ ok: true, value: { vectors: [] } }),
      embedQueries: async () => ({
        ok: true,
        value: {
          vectors: [new Array(LOCAL_EMBEDDING_IDENTITY.dimension).fill(0)],
        },
      }),
    };
    const lexical = {
      search: jest.fn(async () => [{ chunkId: persisted.id }]),
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
    const hits = await rag.search('체중 기록', evidence.chunks);
    expect(hits).toHaveLength(1);
    expect(hits[0].chunk.metadata.evidenceId).toBe(
      evidence.items[0].evidenceId,
    );
    expect(JSON.stringify(hits)).not.toContain('private-observation');
    expect(lexical.search).toHaveBeenCalledWith(
      '체중 기록',
      [persisted],
      20,
      undefined,
    );

    // Remove the underlying row without updating the retained snapshot, as a deletion race would do.
    await database.execute('DELETE FROM health_observations WHERE id = ?', [
      row.record.id,
    ]);
    await expect(rag.search('체중 기록', evidence.chunks)).resolves.toEqual([]);
    expect(lexical.search).toHaveBeenCalledTimes(1);
    await expect(
      registry.revalidateEvidence(evidence.items, new AbortController().signal),
    ).resolves.toBe(false);
  } finally {
    close();
  }
});
