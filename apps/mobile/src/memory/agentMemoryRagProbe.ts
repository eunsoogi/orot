import type { DocumentQueryEmbeddingProvider, EvidenceChunk } from '@orot/rag';
import {
  LOCAL_EMBEDDING_IDENTITY,
  searchHybridEvidenceChunks,
} from '@orot/rag';
import type { SqlDatabase } from '@orot/storage';
import { SqlCipherRagFullTextSearchStore } from '../storage/ragFullTextSearch';
import { SqlCipherRagEmbeddingStorage } from '../storage/ragEmbeddingStorage';

export const AGENT_MEMORY_PROBE_CHUNK_ID = 'agent-memory-synthetic-chunk';

const staleWorkflowChunkText =
  '사용자는 외래 일정 알림을 오전 10시에 받고 싶어 한다.';
const staleWorkflowQuery = '외래 일정 알림';

/** Checks a persisted deletion fence against the same stale chunk a resumed graph may hold. */
export async function assertAgentMemoryRagProbeSearch(
  database: SqlDatabase,
  sourceId: string,
  shouldBeVisible: boolean,
): Promise<void> {
  const chunk: EvidenceChunk = {
    id: AGENT_MEMORY_PROBE_CHUNK_ID,
    text: staleWorkflowChunkText,
    metadata: {
      sourceId,
      sourceRecordIds: [sourceId],
      evidenceId: AGENT_MEMORY_PROBE_CHUNK_ID,
      evidenceLocator: { kind: 'structured_record', recordId: sourceId },
      effectiveTime: null,
      recordType: 'symptom_entry',
      reviewState: { status: 'unreviewed' },
    },
  };
  const provider: DocumentQueryEmbeddingProvider = {
    modelIdentity: LOCAL_EMBEDDING_IDENTITY,
    async embedDocuments({ input }) {
      return { ok: true, value: { vectors: input.map(syntheticRagVector) } };
    },
    async embedQueries({ input }) {
      return { ok: true, value: { vectors: input.map(syntheticRagVector) } };
    },
  };
  const hits = await searchHybridEvidenceChunks(
    staleWorkflowQuery,
    [chunk],
    provider,
    new SqlCipherRagEmbeddingStorage(database),
    new SqlCipherRagFullTextSearchStore(database),
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
  } else if (hits.length !== 0) {
    throw new Error('A deleted source chunk returned from hybrid search.');
  }
}

/** Produces a normalized deterministic vector so simulator proof needs no model download. */
export function createAgentMemoryProbeRagVector(): number[] {
  return syntheticRagVector();
}

function syntheticRagVector(): number[] {
  const vector = new Array<number>(LOCAL_EMBEDDING_IDENTITY.dimension).fill(0);
  vector[0] = 1;
  return vector;
}
