import { LOCAL_EMBEDDING_IDENTITY } from '@orot/rag';
import {
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

import {
  createAgentMemoryProbeFixture,
  deterministicProvider,
  originalText,
  correctedText,
} from './agentMemoryProbeFixtures';
export { deterministicProvider } from './agentMemoryProbeFixtures';

type DeletionProbeMode = 'delete' | 'tombstone-restart' | 'verify-deletion';
export type AgentMemoryProbeMode = 'fresh' | 'restart' | DeletionProbeMode;

export async function runAgentMemoryProbe(
  mode: AgentMemoryProbeMode,
  fixtureIdentifier?: string,
): Promise<void> {
  const { sourceRecord, memoryInput, chunkId } =
    createAgentMemoryProbeFixture(fixtureIdentifier);
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
          chunkId,
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
    } else if (mode === 'restart' || mode === 'delete') {
      // Both profiles share the durable delete path; restart also proves the RAG positive control first.
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
      // Other native cases share this model index; verify this source's exact vector rather than its neighbors.
      const sourceVectors = vectors.filter(
        vector => vector.chunkId === chunkId,
      );
      if (sourceVectors.length !== 1 || sourceVectors[0]?.chunkId !== chunkId) {
        throw new Error(
          'The synthetic source vector did not survive relaunch.',
        );
      }
      await assertAgentMemoryRagProbeSearch(
        embeddingDatabase,
        sourceRecord.id,
        true,
        chunkId,
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
        (await embeddingStorage.listForModel(LOCAL_EMBEDDING_IDENTITY)).some(
          vector => vector.chunkId === chunkId,
        )
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
        (await embeddingStorage.listForModel(LOCAL_EMBEDDING_IDENTITY)).some(
          vector => vector.chunkId === chunkId,
        )
      ) {
        throw new Error('The removed source vector returned after relaunch.');
      }
      await assertAgentMemoryRagProbeSearch(
        embeddingDatabase,
        sourceRecord.id,
        false,
        chunkId,
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
