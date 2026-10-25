import type { AgentMemoryHit, AgentMemoryStorageAdapter, PersistedMemoryRecord } from './types';
import { isAgentMemoryKind, isProvenance, metadataFrom, provenanceFrom } from './validation';

/** A lookup always resolves durable metadata, including live provenance invalidation. */
export async function readMemoryByKey(
  storage: AgentMemoryStorageAdapter,
  memoryKey: string,
): Promise<Omit<AgentMemoryHit, 'score'> | null> {
  const [record] = await recordsForKey(storage, memoryKey);
  if (!record) return null;
  const metadata = metadataFrom(record.meta);
  if (!isAgentMemoryKind(metadata.kind) || !isProvenance(metadata.provenance)) return null;
  return {
    memoryKey: memoryKey.trim(),
    id: record.id,
    text: record.text,
    kind: metadata.kind,
    provenance: metadata.provenance,
    createdAt: record.createdAt,
  };
}

export async function recordsForKey(
  storage: AgentMemoryStorageAdapter,
  memoryKey: string,
): Promise<PersistedMemoryRecord[]> {
  if (typeof memoryKey !== 'string' || !memoryKey.trim())
    throw new Error('A stable memory key is required.');
  // Direct key reads must honor the same live provenance fences as semantic recall.
  const invalidated = new Set(await storage.listInvalidatedSourceIds());
  return (await storage.listRecords())
    .filter(
      (record) =>
        metadataFrom(record.meta).memoryKey === memoryKey.trim() &&
        !provenanceFrom(record.meta)?.sourceIds.some((id) => invalidated.has(id)),
    )
    .sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id));
}
