import type { EvidenceSearchRuntime } from '@orot/agent-runtime';
import { AGENT_MEMORY_NAMESPACE } from '@orot/agent-memory';
import { LOCAL_MEMORY_MAX_RESULTS } from '@orot/agent-runtime';
import type { LocalMemoryHit } from '@orot/agent-runtime';

type GraphStore = NonNullable<EvidenceSearchRuntime['store']>;
type GraphStoreItem = Awaited<ReturnType<GraphStore['search']>>[number];

export interface ReviewedMemorySearchResult {
  readonly hits: readonly LocalMemoryHit[];
  readonly truncated: boolean;
  readonly unavailable: boolean;
}

/** Graph research reads only its injected Store; the query service remains a freshness check. */
export async function searchReviewedMemoryFromStore(
  store: EvidenceSearchRuntime['store'],
  query: string,
  limit: number,
): Promise<ReviewedMemorySearchResult> {
  if (!store) return unavailable();
  const boundedLimit = Math.min(limit, LOCAL_MEMORY_MAX_RESULTS);
  if (!query.trim() || !Number.isInteger(boundedLimit) || boundedLimit < 1) {
    return unavailable();
  }
  const probeLimit = Math.min(boundedLimit + 1, LOCAL_MEMORY_MAX_RESULTS);
  try {
    const items = await store.search([...AGENT_MEMORY_NAMESPACE], {
      query,
      limit: probeLimit,
    });
    const hits = items
      .flatMap(item => {
        const hit = toLocalMemoryHit(item);
        return hit ? [hit] : [];
      })
      .slice(0, boundedLimit);
    return {
      hits,
      truncated:
        items.length > boundedLimit ||
        (boundedLimit === LOCAL_MEMORY_MAX_RESULTS &&
          items.length >= LOCAL_MEMORY_MAX_RESULTS),
      unavailable: false,
    };
  } catch {
    return unavailable();
  }
}

function unavailable(): ReviewedMemorySearchResult {
  return { hits: [], truncated: false, unavailable: true };
}

function toLocalMemoryHit(item: GraphStoreItem): LocalMemoryHit | null {
  const value = item.value;
  const provenance = value.provenance;
  const score = item.score ?? value.score;
  if (
    typeof value.memoryKey !== 'string' ||
    value.memoryKey !== item.key ||
    typeof value.id !== 'string' ||
    typeof value.text !== 'string' ||
    (value.kind !== 'preference' &&
      value.kind !== 'reviewed_interaction' &&
      value.kind !== 'task_context') ||
    !isMemoryProvenance(provenance) ||
    typeof value.createdAt !== 'number'
  ) {
    return null;
  }
  return {
    id: value.id,
    text: value.text,
    score: typeof score === 'number' ? score : 0,
    kind: value.kind,
    provenance,
    createdAt: value.createdAt,
  };
}

function isMemoryProvenance(
  value: unknown,
): value is LocalMemoryHit['provenance'] {
  if (!value || typeof value !== 'object') return false;
  const provenance = value as LocalMemoryHit['provenance'];
  return (
    Array.isArray(provenance.sourceIds) &&
    provenance.sourceIds.every(id => typeof id === 'string') &&
    (provenance.reviewState === 'user_confirmed' ||
      provenance.reviewState === 'human_reviewed') &&
    (provenance.sourceDates === undefined ||
      (Array.isArray(provenance.sourceDates) &&
        provenance.sourceDates.every(
          sourceDate =>
            typeof sourceDate === 'object' &&
            sourceDate !== null &&
            typeof sourceDate.sourceId === 'string' &&
            typeof sourceDate.date === 'string',
        )))
  );
}
