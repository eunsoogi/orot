import type { EvidenceChunk } from '@orot/rag';
import { LOCAL_EMBEDDING_IDENTITY } from '@orot/rag';
import type { SqlDatabase } from '@orot/storage';
import { createLocalE5RagService } from '../rag/localE5RagService';

import { AGENT_MEMORY_PROBE_CHUNK_ID } from './agentMemoryProbeFixtures';

const staleWorkflowChunkText =
  '사용자는 외래 일정 알림을 오전 10시에 받고 싶어 한다.';
const staleWorkflowQuery = '외래 일정 알림';

/** Checks a persisted deletion fence against the same stale chunk a resumed graph may hold. */
export async function assertAgentMemoryRagProbeSearch(
  database: SqlDatabase,
  sourceId: string,
  shouldBeVisible: boolean,
  chunkId = AGENT_MEMORY_PROBE_CHUNK_ID,
): Promise<void> {
  const chunk = createAgentMemoryProbeChunk(sourceId, chunkId);
  const hits = await createAgentMemoryProbeRag(database).search(
    staleWorkflowQuery,
    [chunk],
    1,
  );
  if (shouldBeVisible) {
    if (
      hits.length !== 1 ||
      hits[0]?.lexicalRank === null ||
      hits[0]?.vectorRank === null
    ) {
      throw new Error('The synthetic RAG probe missed a live source chunk.');
    }
  } else {
    if (hits.length !== 0)
      throw new Error('A deleted source chunk returned from hybrid search.');
    // A resumed graph must not resurrect vectors even after the SQLCipher service reopens.
    try {
      await createAgentMemoryProbeRag(database).index([chunk]);
    } catch (error) {
      if (error instanceof Error && error.message.includes('Removed evidence'))
        return;
      throw error;
    }
    throw new Error(
      'A deleted source accepted a delayed standard vector write.',
    );
  }
}

/** Shares the exact citation snapshot between standard indexing and stale-workflow retrieval. */
export function createAgentMemoryProbeChunk(
  sourceId: string,
  chunkId: string,
): EvidenceChunk {
  return {
    id: chunkId,
    text: staleWorkflowChunkText,
    metadata: {
      sourceId,
      sourceRecordIds: [sourceId],
      evidenceId: chunkId,
      evidenceLocator: { kind: 'structured_record', recordId: sourceId },
      effectiveTime: null,
      recordType: 'symptom_entry',
      reviewState: { status: 'unreviewed' },
    },
  };
}

/** Exercises production adapters with deterministic native-role input and no model download. */
export function createAgentMemoryProbeRag(database: SqlDatabase) {
  return createLocalE5RagService(database, {
    async prepare() {},
    async embedBatch(input) {
      return input.map(syntheticRagVector);
    },
    cancel() {},
  });
}

function syntheticRagVector(): number[] {
  const vector = new Array<number>(LOCAL_EMBEDDING_IDENTITY.dimension).fill(0);
  vector[0] = 1;
  return vector;
}
