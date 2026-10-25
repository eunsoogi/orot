import type { AgentMemoryStorageAdapter, PersistedMemoryRecord } from './types';

/** Namespace comes from trusted application setup, never a model-authored memory draft. */
export function namespacedStorage(
  storage: AgentMemoryStorageAdapter,
  namespace: readonly string[] = [],
): AgentMemoryStorageAdapter {
  if (
    !Array.isArray(namespace) ||
    namespace.some((part) => typeof part !== 'string' || !part.trim())
  ) {
    throw new Error('Memory namespace must contain non-empty strings.');
  }
  const trustedNamespace = namespace.map((part) => part.trim());
  const identity = JSON.stringify(trustedNamespace);
  const owns = (record: PersistedMemoryRecord): boolean => {
    // Only absent metadata is legacy data. Invalid namespace metadata must fail closed.
    const stored = record.meta.namespace;
    return JSON.stringify(stored === undefined ? [] : stored) === identity;
  };
  const listRecords = async () => (await storage.listRecords()).filter(owns);
  return {
    load: listRecords,
    listRecords,
    append: (record) => {
      // Rememori retains this mutable record; bind both its index and durable row to the same scope.
      record.meta.namespace = [...trustedNamespace];
      return storage.append(record);
    },
    tombstone: async (id) => {
      if ((await listRecords()).some((record) => record.id === id)) await storage.tombstone(id);
    },
    compact: async (records) => {
      if (records.some((record) => !owns(record))) throw new Error('Memory namespace mismatch.');
      // Rememori only sees this namespace; its compaction must retain all other durable rows.
      const others = (await storage.listRecords()).filter((record) => !owns(record));
      await storage.compact([...others, ...records]);
    },
    // Source identities and deletion fences belong to the app, across namespaces.
    listRemovedSourceIds: () => storage.listRemovedSourceIds(),
    listInvalidatedSourceIds: () => storage.listInvalidatedSourceIds(),
    markSourceRemoved: (sourceId) => storage.markSourceRemoved(sourceId),
    beginBatch: () => storage.beginBatch(),
    commitBatch: () => storage.commitBatch(),
    rollbackBatch: () => storage.rollbackBatch(),
    close: () => storage.close(),
  };
}
