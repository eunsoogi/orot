import { isAgentMemoryProvenance } from '@orot/agent-memory';
import type {
  AgentMemoryProvenance,
  AgentMemoryService,
  PersistedMemoryRecord,
} from '@orot/agent-memory';
import type { LocalMemoryReader } from '@orot/agent-runtime';
import {
  isLocalConversationMemoryId,
  localConversationMemoryIdPrefix,
} from '@orot/storage';

/** Local notes are never provider-facing evidence, even if a migrated row has only
 * its durable local-only key or only its local-only provenance. */
export function isProviderVisibleMemory(
  provenance: Pick<AgentMemoryProvenance, 'sourceIds' | 'sourceReferences'>,
  memoryKey?: unknown,
): boolean {
  return (
    (memoryKey === undefined || typeof memoryKey === 'string') &&
    !memoryKey?.startsWith(
      'manual-history-memory:' + localConversationMemoryIdPrefix,
    ) &&
    !provenance.sourceIds.some(isLocalConversationMemoryId) &&
    !provenance.sourceReferences?.some(source =>
      isLocalConversationMemoryId(source.id),
    )
  );
}

export function providerVisiblePersistedMemory(
  record: PersistedMemoryRecord,
): boolean {
  const meta = record.meta;
  return (
    isAgentMemoryProvenance(meta?.provenance) &&
    isProviderVisibleMemory(meta.provenance, meta.memoryKey)
  );
}

export function providerVisibleMemoryReader(
  memory: LocalMemoryReader,
): LocalMemoryReader {
  return {
    recall: async (query, options) =>
      (await memory.recall(query, options)).filter(hit =>
        isProviderVisibleMemory(hit.provenance, hit.memoryKey),
      ),
  };
}

/** The graph's existing memory namespace has ranked, exact-key and filter-by-ID reads. */
export function providerVisibleAgentMemory(
  memory: AgentMemoryService,
): AgentMemoryService {
  function visible<
    Hit extends { provenance: AgentMemoryProvenance; memoryKey?: string },
  >(hit: Hit | null) {
    return hit && isProviderVisibleMemory(hit.provenance, hit.memoryKey)
      ? hit
      : null;
  }
  return {
    getById: async id => visible(await memory.getById(id)),
    getByKey: async key => visible(await memory.getByKey(key)),
    recall: async (query, options) =>
      (await memory.recall(query, options)).flatMap(hit => visible(hit) ?? []),
    forgetByKey: (...args) => memory.forgetByKey(...args),
    remember: (...args) => memory.remember(...args),
    update: (...args) => memory.update(...args),
    forget: (...args) => memory.forget(...args),
    forgetBySourceId: (...args) => memory.forgetBySourceId(...args),
    forgetAll: (...args) => memory.forgetAll(...args),
    removeSource: (...args) => memory.removeSource(...args),
    close: (...args) => memory.close(...args),
  };
}
