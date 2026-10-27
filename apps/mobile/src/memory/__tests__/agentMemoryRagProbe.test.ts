import {
  assertAgentMemoryRagProbeSearch,
  createAgentMemoryProbeChunk,
  createAgentMemoryProbeRag,
} from '../agentMemoryRagProbe';
import { SqlCipherRagEmbeddingStorage } from '../../storage/ragEmbeddingStorage';
import {
  installFingerprint,
  openDatabase,
} from '../../storage/testSupport/vectorStore';

jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
}));

it('indexes native-probe citations through standard revisions and rejects stale writes after deletion', async () => {
  installFingerprint();
  const opened = await openDatabase();
  try {
    const sourceId = 'source-a';
    const chunkId = 'probe-standard-index';
    await createAgentMemoryProbeRag(opened.database).index([
      createAgentMemoryProbeChunk(sourceId, chunkId),
    ]);
    const revisions = await opened.database.execute(
      'SELECT chunk_id FROM rag_vector_document_revisions',
    );
    expect(revisions.rows).toEqual([{ chunk_id: chunkId }]);
    await assertAgentMemoryRagProbeSearch(
      opened.database,
      sourceId,
      true,
      chunkId,
    );
    await new SqlCipherRagEmbeddingStorage(opened.database).deleteEvidence(
      [sourceId],
      [chunkId],
    );
    // A new service instance must consume the persisted fence, including its delayed-write rejection.
    await assertAgentMemoryRagProbeSearch(
      opened.database,
      sourceId,
      false,
      chunkId,
    );
  } finally {
    opened.close();
  }
});
