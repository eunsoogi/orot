import type { AgentMemoryHit, AgentMemoryStorageAdapter } from './types';
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
    const metadata = metadataFrom(record.meta);
    if (
      invalidated.has(record.id) ||
      typeof metadata.memoryKey !== 'string' ||
      !metadata.memoryKey.trim() ||
      !isAgentMemoryKind(metadata.kind) ||
      !isProvenance(metadata.provenance) ||
      metadata.provenance.sourceIds.some((id) => invalidated.has(id)) ||
      typeof record.text !== 'string' ||
      !record.text.trim() ||
      !Number.isFinite(record.createdAt) ||
      !Number.isFinite(new Date(record.createdAt).getTime())
    )
      return [];
    return [
      {
        id: record.id,
        memoryKey: metadata.memoryKey,
        text: record.text,
        kind: metadata.kind,
        provenance: metadata.provenance,
        createdAt: record.createdAt,
      },
    ];
  });
  if (((await storage.listQuarantineRevision?.()) ?? '') !== revision) {
    // A changed quarantine is not a genuine empty store: allow the UI to offer a retry.
    throw new Error('Saved memory changed during reading.');
  }
  return result.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
}
