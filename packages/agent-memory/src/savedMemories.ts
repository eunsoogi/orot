import type { AgentMemoryHit, AgentMemoryStorageAdapter, PersistedMemoryRecord } from './types';
import { namespacedStorage } from './namespacedStorage';
import { isAgentMemoryKind, isProvenance, metadataFrom } from './validation';

/** Enumerates saved default-scope memories without opening Rememori or embedding private text. */
export async function listSavedMemories(
  storage: AgentMemoryStorageAdapter,
): Promise<Omit<AgentMemoryHit, 'score'>[]> {
  const revision = (await storage.listQuarantineRevision?.()) ?? '';
  const records = await namespacedStorage(storage).listRecords();
  // Read fences after rows so a deletion during the read cannot resurrect its old text.
  const invalidated = new Set([
    ...(await storage.listInvalidatedSourceIds()),
    ...(await storage.listRemovedSourceIds()),
  ]);
  const result = records.flatMap((record) => {
    const snapshot = projectDefaultSavedMemory(record);
    if (
      !snapshot ||
      invalidated.has(snapshot.id) ||
      snapshot.provenance.sourceIds.some((id) => invalidated.has(id))
    )
      return [];
    return [snapshot];
  });
  if (((await storage.listQuarantineRevision?.()) ?? '') !== revision) {
    // A changed quarantine is not a genuine empty store: allow the UI to offer a retry.
    throw new Error('Saved memory changed during reading.');
  }
  return result.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
}

/** Validates a durable default-scope row for rendering; does not decide evidence eligibility. */
export function projectDefaultSavedMemory(
  record: PersistedMemoryRecord,
): Omit<AgentMemoryHit, 'score'> | null {
  const namespace = record.meta.namespace;
  if (namespace !== undefined && (!Array.isArray(namespace) || namespace.length !== 0)) return null;
  const metadata = metadataFrom(record.meta);
  if (
    typeof metadata.memoryKey !== 'string' ||
    !metadata.memoryKey.trim() ||
    !isAgentMemoryKind(metadata.kind) ||
    !isProvenance(metadata.provenance) ||
    typeof record.text !== 'string' ||
    !record.text.trim() ||
    !Number.isFinite(record.createdAt) ||
    !Number.isFinite(new Date(record.createdAt).getTime())
  )
    return null;
  return {
    id: record.id,
    memoryKey: metadata.memoryKey,
    text: record.text,
    kind: metadata.kind,
    provenance: metadata.provenance,
    createdAt: record.createdAt,
  };
}
