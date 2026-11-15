import { createColdResearchSourceReader } from './coldResearchSourceReader';
import type { ConversationArtifactSource } from '../../ragConversation/conversationArtifactSources';
import { isConversationPhotoSource } from '../../ragConversation/conversationArtifactSources';
import { restoreColdPhotoEvidence } from './restoreColdPhotoEvidence';
import { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import type { EvidenceRegistrySnapshot } from './evidenceRegistrySnapshot';
import type { AiFeatureLocalData } from './localData';
import { restoreRetainedSources } from './restoreRetainedSources';
import { stableJson } from './evidenceUtils';

/** Rebind protected aliases to fresh local readers, not to a new search or regenerated answer.
 * The caller must validate the protected descriptor and fence its source epoch again at claim.
 * Photo readers require an explicit protected owner. External batches, graph invocation and
 * consent are not restored here; local reader reconstruction is not a transmission grant. */
export async function restoreColdConversationRegistry(input: {
  snapshot: EvidenceRegistrySnapshot;
  sources: readonly ConversationArtifactSource[];
  data: AiFeatureLocalData;
  signal: AbortSignal;
  photo?: Pick<
    Parameters<typeof restoreColdPhotoEvidence>[0],
    'submitted' | 'owner'
  >;
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
  const sources: readonly ConversationArtifactSource[] = JSON.parse(
    JSON.stringify(input.sources),
  );
  const photos = sources.filter(isConversationPhotoSource);
  if (photos.length && !input.photo)
    throw new Error('Cold photo owner is required.');
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
          'conversation_photo',
        ].includes(kind))
    )
      throw new Error('Unsupported cold source descriptor.');
  }
  const fresh = new LocalEvidenceReferenceRegistry();
  if (photos.length)
    await restoreColdPhotoEvidence({
      ...input.photo!,
      sources: photos,
      data: input.data,
      registry: fresh,
      signal: input.signal,
    });
  const research = createColdResearchSourceReader({
    snapshot,
    sources: sources.filter(source => !isConversationPhotoSource(source)),
    data: input.data,
  });
  for (const source of sources) {
    check();
    if (isConversationPhotoSource(source)) continue;
    if (
      'kind' in source &&
      (source.kind === 'generated_research' ||
        source.kind === 'generated_conversation')
    ) {
      const readSource = (signal: AbortSignal) => research.read(source, signal);
      fresh.add({
        reference: source.reference,
        content: '',
        readSource,
        validate: async signal =>
          (await readSource(signal)).status === 'available',
      });
      continue;
    }
    // The existing source readers perform local revision checks. They do not invoke tools/models.
    const result = await restoreRetainedSources([source], fresh, input.data);
    check();
    if (
      result.sourceChanged ||
      !result.mapping.has(stableJson(source.reference))
    )
      throw new Error('Cold source changed or is unavailable.');
  }
  // Import before validating research: its dependency links must point into this final owner.
  const restored = LocalEvidenceReferenceRegistry.restore(snapshot, fresh);
  research.bind(restored);
  for (const { alias } of restored.snapshot().entries) {
    check();
    if (!(await restored.revalidateEvidence([alias], input.signal)))
      throw new Error('Cold source failed fresh validation.');
    const read = await restored.readSource(alias, input.signal);
    check();
    if (
      read.status !== 'available' ||
      (read.document.sourceKind === 'generated_artifact' &&
        read.document.sourceStatus === 'changed')
    )
      throw new Error('Cold source is no longer current.');
  }
  check();
  return restored;
}
