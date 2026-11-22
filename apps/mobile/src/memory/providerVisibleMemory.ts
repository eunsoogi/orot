import { isAgentMemoryProvenance } from '@orot/agent-memory';
import type {
  AgentMemoryProvenance,
  AgentMemoryService,
  PersistedMemoryRecord,
} from '@orot/agent-memory';
import {
  LOCAL_MEMORY_MAX_RESULTS,
  type LocalMemoryReader,
} from '@orot/agent-runtime';
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

// Pinned Rememori 0.7.0 uses max(limit * 8, 64) for HNSW candidates.
// Headroom must not move a small existing request above that search window.
const recallCandidateCeiling = 8;

/** Recover an eligible small-page hit hidden behind local-only notes. Rank once,
 * reserve only a fixed extra local candidate window, then enforce the original
 * privacy predicate and result count. Do not expand large/unbounded requests. */
async function recallVisible<
  Hit extends {
    provenance: Parameters<typeof isProviderVisibleMemory>[0];
    memoryKey?: string;
  },
>(
  limit: number | undefined,
  recall: (candidateLimit?: number) => Promise<readonly Hit[]>,
): Promise<Hit[]> {
  const bounded =
    typeof limit === 'number' &&
    Number.isInteger(limit) &&
    limit >= 1 &&
    limit <= Math.min(LOCAL_MEMORY_MAX_RESULTS, recallCandidateCeiling);
  const candidateLimit = bounded
    ? Math.min(limit + LOCAL_MEMORY_MAX_RESULTS, recallCandidateCeiling)
    : 0;
  const candidates = await recall(bounded ? candidateLimit : undefined);
  const visible = (
    bounded ? candidates.slice(0, candidateLimit) : candidates
  ).filter(hit => isProviderVisibleMemory(hit.provenance, hit.memoryKey));
  return bounded ? visible.slice(0, limit) : visible;
}

export function providerVisibleMemoryReader(
  memory: LocalMemoryReader,
): LocalMemoryReader {
  return {
    recall: (query, options) =>
      recallVisible(options?.limit, candidateLimit =>
        memory.recall(
          query,
          candidateLimit === undefined
            ? options
            : { ...options, limit: candidateLimit },
        ),
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
    recall: (query, options) =>
      recallVisible(options?.limit, candidateLimit =>
        memory.recall(
          query,
          candidateLimit === undefined
            ? options
            : { ...options, limit: candidateLimit },
        ),
      ),
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
