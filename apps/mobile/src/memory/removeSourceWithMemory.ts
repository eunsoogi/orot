import type { AgentMemoryService } from '@orot/agent-memory';
import { RecordIdSchema } from '@orot/domain';
import { createLocalE5RagService } from '../rag/localE5RagService';
import {
  openLocalAgentMemoryDatabase,
  openLocalStorage,
} from '../storage/secureDatabase';

export interface SourceMemoryDeletionResult {
  readonly sourceDeleted: boolean;
  readonly memoriesDeleted: number;
}

/** Deletes a source record and memories that cite the source or one of its cascading records. */
export async function removeLocalSourceWithMemory(
  sourceId: string,
  memory: AgentMemoryService,
): Promise<SourceMemoryDeletionResult> {
  const normalizedSourceId = RecordIdSchema.parse(sourceId);
  const [database, repository] = await Promise.all([
    openLocalAgentMemoryDatabase(),
    openLocalStorage(),
  ]);
  const rag = createLocalE5RagService(database);
  await rag.prepare();
  // Capture the same cascade roots before SQL removal so transcript-only memory references are deleted too.
  const deletionReferences =
    await repository.listSourceDeletionReferences(normalizedSourceId);
  return memory.removeSource(
    normalizedSourceId,
    () =>
      repository.sourceRecords.delete(normalizedSourceId, transaction =>
        rag.deleteChunks([], [normalizedSourceId], transaction),
      ),
    deletionReferences,
  );
}
