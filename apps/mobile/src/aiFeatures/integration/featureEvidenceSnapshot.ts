import type { EvidenceCandidateScope } from '../../healthEvidence/evidenceCandidateScope';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { createLocalEvidenceSnapshot } from './evidenceSnapshot';
import type { LocalEvidenceSnapshot } from './evidenceSnapshot';
import type { AiFeatureLocalData } from './localData';
import { fingerprint } from './evidenceUtils';

const indexedChunkFingerprints = new WeakMap<object, Map<string, string>>();

/** A memory tool reads only reviewed memory; unrelated clinical records are never selected or embedded. */
export async function loadFeatureMemorySnapshot(
  data: AiFeatureLocalData,
  registry: LocalEvidenceReferenceRegistry,
  signal: AbortSignal,
): Promise<LocalEvidenceSnapshot> {
  if (signal.aborted)
    throw new Error('The local evidence request was cancelled.');
  const memoryRecords = await data.loadMemoryRecords();
  const identifiers = await data.findIdentifiers(
    JSON.stringify(
      memoryRecords.map(record => ({ text: record.text, meta: record.meta })),
    ),
    signal,
  );
  if (signal.aborted)
    throw new Error('The local evidence request was cancelled.');
  for (const identifier of identifiers)
    registry.registerSensitiveIdentifier(identifier);
  return createLocalEvidenceSnapshot({
    // The personal corpus was not searched, so this snapshot makes no inventory claim about it.
    inventory: {
      inventoryComplete: false,
      availableKinds: [],
      queriedKinds: [],
      unsupportedKinds: [],
      truncatedKinds: [],
    },
    records: [],
    manualHistoryCandidates: [],
    persistedChunks: [],
    loadCurrentPersistedChunks: async () => [],
    staleArtifacts: [],
    loadCurrentStaleArtifacts: async () => [],
    repository: data.repository,
    manualHistory: data.manualHistory,
    memoryRecords,
    memoryStorage: data.memoryStorage,
    registry,
  });
}

/** Loads a ranked window plus exact dependencies; catalog coverage is separate from payload size. */
export async function loadFeatureEvidenceSnapshot(
  data: AiFeatureLocalData,
  registry: LocalEvidenceReferenceRegistry,
  signal: AbortSignal,
  query = '',
  scope?: EvidenceCandidateScope,
): Promise<LocalEvidenceSnapshot> {
  if (signal.aborted)
    throw new Error('The local evidence request was cancelled.');
  const selection = await data.readCandidates(query, signal, scope);
  const manualHistorySelection = await data.readManualHistoryCandidates(
    query,
    signal,
    scope,
  );
  const identities = selection.candidates.map(entry => ({
    kind: entry.kind,
    id: entry.record.id,
  }));
  const persistedChunks = await data.loadCurrentChunks(identities, signal);
  // Linked extracted names need the same transcript-revision guard as selected clinical rows.
  const staleIdentities = [
    ...identities,
    ...selection.dependencies
      .filter(
        entry =>
          entry.kind === 'medication_assertion' &&
          entry.record.provenance.origin === 'derived',
      )
      .map(entry => ({ kind: entry.kind, id: entry.record.id })),
  ];
  const staleArtifacts = await data.loadStaleArtifacts(staleIdentities, signal);
  // A personal health overview neither queries nor embeds unrelated reviewed memory.
  const memoryRecords =
    scope?.selection === 'health_overview'
      ? []
      : await data.loadMemoryRecords();
  const records = [...selection.candidates, ...selection.dependencies];
  const identifiers = await data.findIdentifiers(
    JSON.stringify(records) +
      JSON.stringify(manualHistorySelection.candidates) +
      JSON.stringify(
        memoryRecords.map(record => ({ text: record.text, meta: record.meta })),
      ),
    signal,
  );
  if (signal.aborted)
    throw new Error('The local evidence request was cancelled.');
  for (const identifier of identifiers)
    registry.registerSensitiveIdentifier(identifier);
  const snapshot = await createLocalEvidenceSnapshot({
    inventory: selection.catalog,
    records,
    candidateRecords: selection.candidates,
    hasMoreCandidates: selection.hasMoreCandidates,
    manualHistoryCandidates: manualHistorySelection.candidates,
    persistedChunks,
    loadCurrentPersistedChunks: () => data.loadCurrentChunks(identities),
    staleArtifacts,
    loadCurrentStaleArtifacts: () => data.loadStaleArtifacts(staleIdentities),
    repository: data.repository,
    manualHistory: data.manualHistory,
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
