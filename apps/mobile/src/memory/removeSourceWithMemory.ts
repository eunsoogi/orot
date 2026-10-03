import type { AgentMemoryService } from '@orot/agent-memory';
import { openLocalStorage } from '../storage/secureDatabase';

export interface SourceMemoryDeletionResult {
  readonly sourceDeleted: boolean;
  readonly memoriesDeleted: number;
}

/** Deletes a source record and any memory entries that retain its provenance. */
export async function removeLocalSourceWithMemory(
  sourceId: string,
  memory: AgentMemoryService,
): Promise<SourceMemoryDeletionResult> {
  const repository = await openLocalStorage();
  const memoriesDeleted = await memory.forgetBySourceId(sourceId);
  const sourceDeleted = await repository.sourceRecords.delete(sourceId);
  return { sourceDeleted, memoriesDeleted };
}
