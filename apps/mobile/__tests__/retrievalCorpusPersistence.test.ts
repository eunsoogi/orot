jest.mock('../src/storage/secureDatabase', () => ({
  openLocalStorage: jest.fn(),
}));

import { openEncryptedStorage } from '@orot/storage';
import type { EvidenceChunk } from '@orot/rag';
import {
  createDatabase,
  options,
} from '../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { prepareRetrievalCorpus } from '../e2e/retrievalCorpusPersistence';
import { openLocalStorage } from '../src/storage/secureDatabase';
import { SqlCipherRagEmbeddingStorage } from '../src/storage/ragEmbeddingStorage';

const chunk: EvidenceChunk = {
  id: 'korean-sleep',
  text: '합성 수면 기록',
  metadata: {
    sourceId: 'korean-sleep',
    sourceRecordIds: ['korean-sleep'],
    evidenceId: 'korean-sleep',
    evidenceLocator: { kind: 'structured_record', recordId: 'korean-sleep' },
    effectiveTime: null,
    recordType: 'symptom_entry',
    reviewState: { status: 'unreviewed' },
  },
};

test('real SQLite fences exclude missing synthetic rows, accept prepared rows and exclude them again after deletion', async () => {
  const database = createDatabase();
  try {
    const repository = await openEncryptedStorage(options(database));
    (openLocalStorage as jest.Mock).mockResolvedValue(repository);
    const vectors = new SqlCipherRagEmbeddingStorage(database);
    const removed = () =>
      vectors.findRemovedEvidence([chunk.id], [chunk.id], [], [chunk.id]);
    await expect(removed()).resolves.toEqual({
      sourceRecordIds: [chunk.id],
      chunkIds: [],
    });
    await prepareRetrievalCorpus([chunk], 'fresh');
    await expect(removed()).resolves.toEqual({
      sourceRecordIds: [],
      chunkIds: [],
    });
    await prepareRetrievalCorpus([chunk], 'restart');
    await database.execute('DELETE FROM symptom_entries WHERE id = ?', [
      chunk.id,
    ]);
    await expect(removed()).resolves.toEqual({
      sourceRecordIds: [chunk.id],
      chunkIds: [],
    });
    await expect(prepareRetrievalCorpus([chunk], 'restart')).rejects.toThrow(
      'did not survive unchanged',
    );
  } finally {
    await database.closeAsync?.();
  }
});

test('prepares hybrid source roots but rejects foreign identities, duplicate rows and fresh overwrite', async () => {
  const database = createDatabase();
  try {
    const repository = await openEncryptedStorage(options(database));
    (openLocalStorage as jest.Mock).mockResolvedValue(repository);
    const source: EvidenceChunk = {
      ...chunk,
      id: 'hybrid-synthetic-sleep',
      metadata: {
        ...chunk.metadata,
        sourceId: 'hybrid-synthetic-sleep',
        sourceRecordIds: ['hybrid-synthetic-sleep'],
        evidenceId: 'hybrid-synthetic-sleep-evidence',
        evidenceLocator: { kind: 'audio_time_range', startMs: 0, endMs: 10 },
      },
    };
    await prepareRetrievalCorpus([source], 'fresh');
    const vectors = new SqlCipherRagEmbeddingStorage(database);
    await expect(
      vectors.findRemovedEvidence([source.id], [source.id], [source.id]),
    ).resolves.toEqual({ sourceRecordIds: [], chunkIds: [] });
    await prepareRetrievalCorpus([source], 'restart');
    await expect(prepareRetrievalCorpus([source], 'fresh')).rejects.toThrow(
      'already exists',
    );
    await expect(
      prepareRetrievalCorpus([source, source], 'fresh'),
    ).rejects.toThrow('unique');
    await expect(
      prepareRetrievalCorpus([{ ...source, id: 'foreign' }], 'fresh'),
    ).rejects.toThrow('foreign');
  } finally {
    await database.closeAsync?.();
  }
});
