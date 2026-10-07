import type { Memory } from 'rememori';
import type { AgentMemoryStorageAdapter } from './types';
import { provenanceFrom } from './validation';

export interface AllMemoryDeletionBatch {
  readonly memoriesDeleted: number;
  readonly sourceIds: readonly string[];
}

/** Deletes through Rememori and fences every known source in the same adapter batch. */
export async function forgetAllPersistedRecords(
  storage: AgentMemoryStorageAdapter,
  engine: Memory,
  sourceRecordIds: readonly string[],
): Promise<AllMemoryDeletionBatch> {
  const normalizedSourceIds = sourceRecordIds.map((sourceId) => sourceId.trim());
  if (normalizedSourceIds.some((sourceId) => !sourceId)) {
    throw new Error('A source identifier is required.');
  }
  const records = await storage.listRecords();
  const sourcesToFence = new Set(normalizedSourceIds);
  for (const record of records) {
    for (const sourceId of provenanceFrom(record.meta)?.sourceIds ?? []) {
      sourcesToFence.add(sourceId);
    }
  }

  let memoriesDeleted = 0;
  for (const record of records) {
    if (await engine.forget(record.id)) memoriesDeleted += 1;
  }
  for (const sourceId of sourcesToFence) await storage.markSourceRemoved(sourceId);
  return { memoriesDeleted, sourceIds: [...sourcesToFence] };
}
