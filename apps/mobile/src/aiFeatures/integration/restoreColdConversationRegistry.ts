import type { ConversationArtifactSource } from '../../ragConversation/conversationArtifactSources';
import { requireNonPhotoSources } from '../../ragConversation/conversationArtifactSources';
import { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import type { EvidenceRegistrySnapshot } from './evidenceRegistrySnapshot';
import type { AiFeatureLocalData } from './localData';
import { restoreRetainedSources } from './restoreRetainedSources';
import { stableJson } from './evidenceUtils';

/** Rebind protected aliases to fresh local readers, not to a new search or regenerated answer.
 * The caller must validate the protected descriptor and fence its source epoch again at claim.
 * External batches, photo ownership, graph invocation and consent are deliberately not restored here. */
export async function restoreColdConversationRegistry(input: {
  snapshot: EvidenceRegistrySnapshot;
  sources: readonly ConversationArtifactSource[];
  data: AiFeatureLocalData;
  signal: AbortSignal;
}): Promise<LocalEvidenceReferenceRegistry> {
  const check = () => {
    if (input.signal.aborted)
      throw new Error('Cold source restoration cancelled.');
  };
  check();
  // Detach before awaiting local storage so mutable caller objects cannot change the binding.
  const snapshot: EvidenceRegistrySnapshot = JSON.parse(
    JSON.stringify(input.snapshot),
  );
  const sources = requireNonPhotoSources(
    JSON.parse(JSON.stringify(input.sources)),
  );
  const originals = new Set(
    snapshot.entries.map(entry => stableJson(entry.original)),
  );
  const keys = sources.map(source => stableJson(source.reference));
  if (
    new Set(keys).size !== keys.length ||
    originals.size !== keys.length ||
    keys.some(key => !originals.has(key))
  )
    throw new Error(
      'Cold source descriptors do not match the exact registry originals.',
    );
  // Do not silently interpret an unknown descriptor as a record descriptor.
  for (const source of sources) {
    const kind = 'kind' in source ? source.kind : undefined;
    const sourceKind = source.reference.sourceKind;
    if (
      (kind === undefined &&
        (!('records' in source) ||
          !Array.isArray(source.records) ||
          !['personal_record', 'reviewed_memory'].includes(sourceKind))) ||
      (kind === 'health_context_period' && sourceKind !== 'personal_record') ||
      (kind?.startsWith('generated_') && sourceKind !== 'generated_artifact') ||
      (kind !== undefined &&
        ![
          'health_context_period',
          'generated_summary',
          'generated_conversation',
          'generated_research',
        ].includes(kind))
    )
      throw new Error('Unsupported cold source descriptor.');
  }
  const fresh = new LocalEvidenceReferenceRegistry();
  for (const source of sources) {
    check();
    // The existing source readers perform local revision checks. They do not invoke tools/models.
    const result = await restoreRetainedSources([source], fresh, input.data);
    check();
    if (
      result.sourceChanged ||
      !result.mapping.has(stableJson(source.reference))
    )
      throw new Error('Cold source changed or is unavailable.');
  }
  // Include reader-created dependency aliases, not just the requested top-level sources.
  for (const { alias } of fresh.snapshot().entries) {
    check();
    if (!(await fresh.revalidateEvidence([alias], input.signal)))
      throw new Error('Cold source failed fresh validation.');
    const read = await fresh.readSource(alias, input.signal);
    check();
    if (
      read.status !== 'available' ||
      (read.document.sourceKind === 'generated_artifact' &&
        read.document.sourceStatus === 'changed')
    )
      throw new Error('Cold source is no longer current.');
  }
  check();
  return LocalEvidenceReferenceRegistry.restore(snapshot, fresh);
}
