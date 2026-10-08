import {
  LOCAL_EMBEDDING_IDENTITY,
  chunkStructuredRecord,
  searchHybridEvidenceChunks,
} from '@orot/rag';
import type {
  DocumentQueryEmbeddingProvider,
  LocalFullTextSearchStore,
} from '@orot/rag';
import { openEncryptedStorage } from '@orot/storage';
import {
  createDatabase,
  join,
  mkdtempSync,
  options,
  rmSync,
  tmpdir,
} from '../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import {
  sample,
  storedSample,
} from '../../healthkit/sleep/sleepImporterFixtures';
import { SqlCipherRagEmbeddingStorage } from '../ragEmbeddingStorage';

function queryProvider(): DocumentQueryEmbeddingProvider {
  return {
    modelIdentity: LOCAL_EMBEDDING_IDENTITY,
    embedDocuments: jest.fn(async () => ({
      ok: true as const,
      value: { vectors: [] },
    })),
    embedQueries: jest.fn(async () => ({
      ok: true as const,
      value: {
        vectors: [new Array(LOCAL_EMBEDDING_IDENTITY.dimension).fill(0)],
      },
    })),
  };
}

describe('HealthKit structured-record retrieval identity', () => {
  it('searches a live sample and excludes its retained chunk after local deletion and reopen', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'orot-rag-healthkit-id-'));
    const databasePath = join(directory, 'local.sqlite');
    let database = createDatabase(databasePath);

    try {
      let repository = await openEncryptedStorage(options(database));
      const record = storedSample(sample('review-live-healthkit-sample'));
      await repository.put('health_observation', record);
      // The provenance uses HealthKit's sample ID; SQL stores a namespaced record ID.
      expect(record.id).toBe('healthkit-sleep:review-live-healthkit-sample');
      expect(record.provenance.sourceRecordIds).toEqual([
        'review-live-healthkit-sample',
      ]);
      const chunk = chunkStructuredRecord('health_observation', record);
      const vectorStore = new SqlCipherRagEmbeddingStorage(database);
      await vectorStore.prepare();
      const textStore: LocalFullTextSearchStore = {
        search: jest.fn(async () => [{ chunkId: chunk.id }]),
      };
      const provider = queryProvider();

      await expect(
        searchHybridEvidenceChunks(
          '합성 수면 기록',
          [chunk],
          provider,
          vectorStore,
          textStore,
        ),
      ).resolves.toMatchObject([{ chunk: { id: chunk.id } }]);
      expect(textStore.search).toHaveBeenCalledTimes(1);

      await repository.deleteAllLocalData(
        async (transaction, _sourceIds, localIds) =>
          vectorStore.clear(localIds, transaction),
      );
      await database.closeAsync?.();

      database = createDatabase(databasePath);
      repository = await openEncryptedStorage(options(database));
      const reopenedVectorStore = new SqlCipherRagEmbeddingStorage(database);
      await reopenedVectorStore.prepare();
      const reopenedTextStore: LocalFullTextSearchStore = {
        search: jest.fn(async () => [{ chunkId: chunk.id }]),
      };

      await expect(
        searchHybridEvidenceChunks(
          '합성 수면 기록',
          [chunk],
          queryProvider(),
          reopenedVectorStore,
          reopenedTextStore,
        ),
      ).resolves.toEqual([]);
      expect(reopenedTextStore.search).not.toHaveBeenCalled();
    } finally {
      await database.closeAsync?.();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
