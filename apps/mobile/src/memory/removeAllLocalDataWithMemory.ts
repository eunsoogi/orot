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

  const sourceRecordIds = (await repository.list('source_record')).map(
    source => source.id,
  );
  const memoriesDeleted = await memory.forgetAll(sourceRecordIds);
  const deleted = await repository.deleteAllLocalData(
    (transaction, deletedSourceIds) => rag.clear(deletedSourceIds, transaction),
  );
  return { ...deleted, memoriesDeleted };
}
