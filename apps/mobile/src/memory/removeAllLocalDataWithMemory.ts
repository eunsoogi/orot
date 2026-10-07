import type { AgentMemoryService } from '@orot/agent-memory';
import type { RecordRepository } from '@orot/storage';
import { createLocalE5RagService } from '../rag/localE5RagService';
import {
  openLocalAgentMemoryDatabase,
  openLocalStorage,
} from '../storage/secureDatabase';

export type AllLocalDataDeletionResult = Awaited<
  ReturnType<RecordRepository['deleteAllLocalData']>
> & { readonly memoriesDeleted: number };

/** Clears memory first so a failed source transaction leaves its original records available. */
export async function removeAllLocalDataWithMemory(
  memory: AgentMemoryService,
): Promise<AllLocalDataDeletionResult> {
  const [database, repository] = await Promise.all([
    openLocalAgentMemoryDatabase(),
    openLocalStorage(),
  ]);
  const rag = createLocalE5RagService(database);
  await rag.prepare();

  // Fence every saved record before Rememori clears its rows, including manual records without sources.
  const localRecordIds = await repository.listAllLocalDeletionReferences();
  const memoriesDeleted = await memory.forgetAll(localRecordIds);
  const deleted = await repository.deleteAllLocalData(
    (transaction, _deletedSourceIds, deletedLocalRecordIds) =>
      rag.clear(deletedLocalRecordIds, transaction),
  );
  return { ...deleted, memoriesDeleted };
}
