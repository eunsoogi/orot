import type { AgentMemoryStorageAdapter } from './types';
import { provenanceFrom } from './validation';

export interface AllMemoryDeletionBatch {
  readonly memoriesDeleted: number;
  readonly referenceIds: readonly string[];
}

/** Deletes all durable namespaces and fences source plus row IDs in the caller's atomic batch. */
export async function forgetAllPersistedRecords(
  storage: AgentMemoryStorageAdapter,
  localRecordIds: readonly string[],
): Promise<AllMemoryDeletionBatch> {
  const normalizedRecordIds = localRecordIds.map((recordId) => recordId.trim());
  if (normalizedRecordIds.some((recordId) => !recordId)) {
    throw new Error('A local record identifier is required.');
  }
  const records = await storage.listRecords();
  const referencesToFence = new Set(normalizedRecordIds);
  for (const record of records) {
    for (const sourceId of provenanceFrom(record.meta)?.sourceIds ?? []) {
      referencesToFence.add(sourceId);
    }
    referencesToFence.add(record.id);
  }

  let memoriesDeleted = 0;
  for (const record of records) {
    await storage.tombstone(record.id);
    memoriesDeleted += 1;
  }
  for (const referenceId of referencesToFence) await storage.markSourceRemoved(referenceId);
  return { memoriesDeleted, referenceIds: [...referencesToFence] };
}
