import type { EmbeddingProvider } from '@orot/agent-memory';
import { LOCAL_EMBEDDING_IDENTITY } from '@orot/rag';
import type { RecordMap } from '@orot/storage';
import {
  AGENT_MEMORY_PROBE_CHUNK_ID,
  assertAgentMemoryRagProbeSearch,
  createAgentMemoryProbeRagVector,
} from './agentMemoryRagProbe';
import {
  closeLocalAgentMemory,
  openLocalAgentMemory,
} from './localAgentMemory';
import { removeLocalSourceWithMemory } from './removeSourceWithMemory';
import { SqlCipherRagEmbeddingStorage } from '../storage/ragEmbeddingStorage';
import {
  openLocalAgentMemoryDatabase,
  openLocalStorage,
} from '../storage/secureDatabase';

export type AgentMemoryProbeMode = 'fresh' | 'restart' | 'verify-deletion';

const sourceRecord = {
  id: 'agent-memory-synthetic-source',
  effectiveAt: '2026-01-02T00:00:00Z',
  recordedAt: '2026-01-02T00:00:00Z',
  ingestedAt: '2026-01-02T00:00:00Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  sourceKind: 'user_note',
  title: 'Synthetic preference source',
  contentHash: 'sha256:' + 'a'.repeat(64),
} satisfies RecordMap['source_record'];

const originalText = '사용자는 외래 일정 알림을 하루 전에 받고 싶어 한다.';
const correctedText = '사용자는 외래 일정 알림을 오전 10시에 받고 싶어 한다.';
const memoryInput = {
  memoryKey: 'preference:outpatient-reminder',
  kind: 'preference' as const,
  provenance: {
    sourceIds: [sourceRecord.id],
    sourceDates: [{ sourceId: sourceRecord.id, date: sourceRecord.recordedAt }],
    reviewState: 'user_confirmed' as const,
  },
};

export const deterministicProvider: EmbeddingProvider = {
  kind: 'embedding',
  id: 'agent-memory-e2e-fixture',
  displayName: 'Synthetic test embedding',
  capabilities: { inputTypes: ['text'] },
  async embed({ input }) {
    return {
      ok: true,
      value: { vectors: input.map(deterministicVector) },
    };
  },
};

export async function runAgentMemoryProbe(
  mode: AgentMemoryProbeMode,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  const networkGlobals = globalThis as typeof globalThis & {
    XMLHttpRequest: typeof XMLHttpRequest;
  };
  const originalXhr = networkGlobals.XMLHttpRequest;
  let networkAttempts = 0;
  globalThis.fetch = (() => {
    networkAttempts += 1;
    throw new Error(
      'Network access is disabled in the synthetic memory probe.',
    );
  }) as typeof fetch;
  networkGlobals.XMLHttpRequest = class {
    constructor() {
      networkAttempts += 1;
      throw new Error(
        'Network access is disabled in the synthetic memory probe.',
      );
    }
  } as typeof XMLHttpRequest;

  try {
    const memory = await openLocalAgentMemory(deterministicProvider);
    if (mode === 'fresh') {
      const repository = await openLocalStorage();
      await repository.sourceRecords.create(sourceRecord);
      // Seed one deterministic vector so deletion is exercised without model download or network access.
      const embeddingStorage = new SqlCipherRagEmbeddingStorage(
        await openLocalAgentMemoryDatabase(),
      );
      await embeddingStorage.upsertBatch(LOCAL_EMBEDDING_IDENTITY, [
        {
          chunkId: AGENT_MEMORY_PROBE_CHUNK_ID,
          vector: createAgentMemoryProbeRagVector(),
          sourceRecordIds: [sourceRecord.id],
        },
      ]);
      const originalId = await memory.remember({
        ...memoryInput,
        text: originalText,
      });
      if (
        (await memory.remember({ ...memoryInput, text: originalText })) !==
        originalId
      ) {
        throw new Error('Repeated memory ingestion was not idempotent.');
      }
      await memory.update({ ...memoryInput, text: correctedText });
      const corrected = await memory.recall(correctedText, {
        minSimilarity: 0.999,
      });
      if (corrected.length !== 1 || corrected[0]?.text !== correctedText) {
        throw new Error('The Korean correction was not recalled.');
      }
      if (
        (await memory.recall(originalText, { minSimilarity: 0.999 })).length !==
        0
      ) {
        throw new Error('The superseded Korean memory remained visible.');
      }
    } else if (mode === 'restart') {
      const repository = await openLocalStorage();
      if (!(await repository.sourceRecords.get(sourceRecord.id))) {
        throw new Error('The synthetic source did not survive relaunch.');
      }
      const embeddingDatabase = await openLocalAgentMemoryDatabase();
      const embeddingStorage = new SqlCipherRagEmbeddingStorage(
        embeddingDatabase,
      );
      const vectors = await embeddingStorage.listForModel(
        LOCAL_EMBEDDING_IDENTITY,
      );
      if (
        vectors.length !== 1 ||
        vectors[0]?.chunkId !== AGENT_MEMORY_PROBE_CHUNK_ID
      ) {
        throw new Error(
          'The synthetic source vector did not survive relaunch.',
        );
      }
      await assertAgentMemoryRagProbeSearch(
        embeddingDatabase,
        sourceRecord.id,
        true,
      );
      const recalled = await memory.recall(correctedText, {
        minSimilarity: 0.999,
      });
      if (recalled.length !== 1 || recalled[0]?.text !== correctedText) {
        throw new Error(
          'The corrected Korean memory did not survive relaunch.',
        );
      }
      const deletion = await removeLocalSourceWithMemory(
        sourceRecord.id,
        memory,
      );
      if (!deletion.sourceDeleted || deletion.memoriesDeleted !== 1) {
        throw new Error(
          'Removing the source did not remove its linked memory.',
        );
      }
      if (await repository.sourceRecords.get(sourceRecord.id)) {
        throw new Error('The removed source record remained in local storage.');
      }
      if (
        (await embeddingStorage.listForModel(LOCAL_EMBEDDING_IDENTITY))
          .length !== 0
      ) {
        throw new Error('The removed source vector remained in local storage.');
      }
      if (
        (await memory.recall(correctedText, { minSimilarity: 0.999 }))
          .length !== 0
      ) {
        throw new Error(
          'A memory linked to a removed source remained visible.',
        );
      }
      await closeLocalAgentMemory();
      const reopened = await openLocalAgentMemory(deterministicProvider);
      let staleWriteRejected = false;
      try {
        await reopened.remember({ ...memoryInput, text: correctedText });
      } catch (error) {
        staleWriteRejected =
          error instanceof Error && error.message.includes('already removed');
      }
      if (!staleWriteRejected)
        throw new Error(
          'A removed source accepted a memory after service reopen.',
        );
    } else {
      const repository = await openLocalStorage();
      if (await repository.sourceRecords.get(sourceRecord.id)) {
        throw new Error('The removed source record returned after relaunch.');
      }
      const embeddingDatabase = await openLocalAgentMemoryDatabase();
      const embeddingStorage = new SqlCipherRagEmbeddingStorage(
        embeddingDatabase,
      );
      if (
        (await embeddingStorage.listForModel(LOCAL_EMBEDDING_IDENTITY))
          .length !== 0
      ) {
        throw new Error('The removed source vector returned after relaunch.');
      }
      await assertAgentMemoryRagProbeSearch(
        embeddingDatabase,
        sourceRecord.id,
        false,
      );
      if (
        (await memory.recall(correctedText, { minSimilarity: 0.999 })).length
      ) {
        throw new Error('The removed source memory returned after relaunch.');
      }
      let staleWriteRejected = false;
      try {
        await memory.remember({ ...memoryInput, text: correctedText });
      } catch (error) {
        staleWriteRejected =
          error instanceof Error && error.message.includes('already removed');
      }
      if (!staleWriteRejected) {
        throw new Error('A removed source accepted memory after relaunch.');
      }
    }
    if (networkAttempts !== 0)
      throw new Error('The memory probe attempted network access.');
  } finally {
    globalThis.fetch = originalFetch;
    networkGlobals.XMLHttpRequest = originalXhr;
    await closeLocalAgentMemory();
  }
}

function deterministicVector(text: string): number[] {
  const vector = new Array<number>(64).fill(0);
  for (let index = 0; index < text.length; index += 1) {
    const bucket = text.charCodeAt(index) % vector.length;
    vector[bucket] += (index % 3) + 1;
  }
  return vector;
}
