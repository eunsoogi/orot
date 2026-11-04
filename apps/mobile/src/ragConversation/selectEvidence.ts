import type { EvidenceBatch, EvidenceItem } from '@orot/agent-runtime';
import type { EvidenceChunk, HybridEvidenceSearchHit } from '@orot/rag';

/** Select only unambiguous ranked hits from the admitted evidence snapshot. */
function chunkKey(chunk: EvidenceChunk): string {
  return `${chunk.metadata.sourceId}\u0000${chunk.metadata.evidenceId}`;
}

export function selectEvidence(
  batch: EvidenceBatch,
  hits: readonly HybridEvidenceSearchHit[],
): EvidenceBatch {
  const byKey = new Map<string, EvidenceItem>();
  const duplicates = new Set<string>();
  for (const item of batch.items) {
    const key = `${item.sourceId}\u0000${item.evidenceId}`;
    if (byKey.has(key)) duplicates.add(key);
    else byKey.set(key, item);
  }
  const items: EvidenceItem[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    const key = chunkKey(hit.chunk);
    const item = byKey.get(key);
    if (!item || duplicates.has(key) || seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }
  const counts = new Map<string, number>();
  for (const item of items)
    counts.set(item.sourceKind, (counts.get(item.sourceKind) ?? 0) + 1);
  return {
    items,
    coverage: batch.coverage.map(coverage => ({
      ...coverage,
      returnedCount: counts.get(coverage.sourceKind) ?? 0,
    })),
    conflicts: [...batch.conflicts],
  };
}
