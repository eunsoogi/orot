import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { createLocalEvidenceSnapshot } from './evidenceSnapshot';
import type { LocalEvidenceSnapshot } from './evidenceSnapshot';
import type { AiFeatureLocalData } from './localData';
import { fingerprint } from './evidenceUtils';

const indexedChunkFingerprints = new WeakMap<object, Map<string, string>>();

/** Rebuilds current local sources and transcript invalidation state for one operation. */
export async function loadFeatureEvidenceSnapshot(
  data: AiFeatureLocalData,
  registry: LocalEvidenceReferenceRegistry,
  signal: AbortSignal,
): Promise<LocalEvidenceSnapshot> {
  if (signal.aborted)
    throw new Error('The local evidence request was cancelled.');
  const [inventory, persistedChunks, memoryRecords, staleArtifacts] =
    await Promise.all([
      data.loadInventory(signal),
      data.loadPersistedChunks(),
      data.loadMemoryRecords(),
      data.loadStaleArtifacts(),
    ]);
  if (signal.aborted)
    throw new Error('The local evidence request was cancelled.');
  const snapshot = await createLocalEvidenceSnapshot({
    inventory,
    persistedChunks,
    loadCurrentPersistedChunks: () => data.loadPersistedChunks(),
    staleArtifacts,
    loadCurrentStaleArtifacts: () => data.loadStaleArtifacts(),
    repository: data.repository,
    memoryRecords,
    memoryStorage: data.memoryStorage,
    registry,
  });

  return snapshot;
}

/** Re-embeds only missing or changed local text while the encrypted RAG service remains open. */
export async function indexChangedFeatureEvidence(
  data: AiFeatureLocalData,
  snapshot: LocalEvidenceSnapshot,
  signal: AbortSignal,
): Promise<void> {
  let fingerprints = indexedChunkFingerprints.get(data.rag);
  if (!fingerprints) {
    fingerprints = new Map();
    indexedChunkFingerprints.set(data.rag, fingerprints);
  }
  const changed = snapshot.chunks.filter(
    chunk => fingerprints?.get(chunk.id) !== fingerprint(chunk.text),
  );
  if (changed.length > 0) {
    await data.rag.index(changed, { signal });
    for (const chunk of changed) {
      fingerprints.set(chunk.id, fingerprint(chunk.text));
    }
  }
}
