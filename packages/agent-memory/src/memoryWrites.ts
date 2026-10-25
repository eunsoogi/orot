import type { Memory } from 'rememori';
import type { AgentMemoryInput, AgentMemoryStorageAdapter } from './types';
import { samePayload, validateInput } from './validation';
import { recordsForKey } from './memoryKeys';

/** Resolves caller keys from durable metadata; no process-local key index is authoritative. */
export async function writeMemory(
  input: AgentMemoryInput,
  storage: AgentMemoryStorageAdapter,
  removedSourceIds: Set<string>,
  getEngine: () => Promise<Memory>,
  runBatch: <T>(operation: () => Promise<T>) => Promise<T>,
): Promise<string> {
  const normalized = validateInput(input);
  const invalidatedSourceIds = new Set(await storage.listInvalidatedSourceIds());
  const invalidatedSourceId = normalized.provenance.sourceIds.find((sourceId) =>
    invalidatedSourceIds.has(sourceId),
  );
  if (invalidatedSourceId)
    throw new Error('Memory cannot reference a superseded transcript revision.');
  const removedSourceId = normalized.provenance.sourceIds.find((sourceId) =>
    removedSourceIds.has(sourceId),
  );
  if (removedSourceId)
    throw new Error('Memory cannot reference a source being or already removed.');
  const matches = await recordsForKey(storage, normalized.memoryKey);
  const current = matches[0];
  const identical = current && samePayload(current, normalized);

  if (identical && matches.length === 1) return current.id;
  return runBatch(async () => {
    const engine = await getEngine();
    if (identical) {
      for (const duplicate of matches)
        if (duplicate.id !== current.id) await engine.forget(duplicate.id);
      return current.id;
    }
    const id = await engine.remember(normalized.text, {
      // Corrections replace the engine ID, but retain the original memory's creation time.
      createdAt: current?.createdAt,
      tags: [normalized.kind],
      importance: normalized.importance,
      entities: [],
      meta: {
        memoryKey: normalized.memoryKey,
        kind: normalized.kind,
        provenance: normalized.provenance,
      },
    });
    for (const record of matches) await engine.forget(record.id);
    return id;
  });
}
