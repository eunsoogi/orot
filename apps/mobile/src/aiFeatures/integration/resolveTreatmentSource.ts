import { referenceOnly } from '../../diseaseHypotheses/resultValidation';
import { stableJson } from './evidenceUtils';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import type { AiFeatureLocalData } from './localData';
import { restoreRetainedSources } from './restoreRetainedSources';
import { treatmentPublicSourceUrl } from './treatmentPublicSourceUrl';
import type { ResolveTreatmentSource } from '../../treatmentContext/treatmentSourceLinks';
import { isConversationPhotoSource } from '../../ragConversation/conversationArtifactSources';

/** Reuse the existing source detail registry while keeping treatment lineage authoritative. */
export function createTreatmentSourceResolver(input: {
  readonly registry: LocalEvidenceReferenceRegistry;
  readonly loadLocalData: () => Promise<AiFeatureLocalData>;
}): ResolveTreatmentSource {
  return async (link, signal) => {
    const { source, isCurrent } = link;
    if (isConversationPhotoSource(source)) return null;
    if (!(await isCurrent(signal))) return null;
    // Public references have no local detail alias. Keep the exact verified locator.
    if (source.reference.sourceKind === 'external_medical')
      return treatmentPublicSourceUrl(source.reference)
        ? referenceOnly(source.reference)
        : null;
    const restored = await restoreRetainedSources(
      [source],
      input.registry,
      await input.loadLocalData(),
    );
    const citation = restored.mapping.get(stableJson(source.reference));
    if (restored.sourceChanged || !citation || !(await isCurrent(signal)))
      return null;
    const readSource = async (readSignal: AbortSignal) => {
      if (!(await isCurrent(readSignal))) return { status: 'changed' as const };
      const result = await input.registry.readSource(citation, readSignal);
      return (await isCurrent(readSignal))
        ? result
        : { status: 'changed' as const };
    };
    return referenceOnly(
      input.registry.add({
        reference: citation,
        content: '',
        readSource,
        validate: async readSignal =>
          (await readSource(readSignal)).status === 'available',
      }),
    );
  };
}
