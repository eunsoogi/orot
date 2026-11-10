import { referenceOnly } from '../../diseaseHypotheses/resultValidation';
import { stableJson } from './evidenceUtils';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import type { AiFeatureLocalData } from './localData';
import { restoreRetainedSources } from './restoreRetainedSources';
import type { ResolveTreatmentSource } from '../../treatmentContext/treatmentSourceLinks';

/** Reuse the existing source detail registry while keeping treatment lineage authoritative. */
export function createTreatmentSourceResolver(input: {
  readonly registry: LocalEvidenceReferenceRegistry;
  readonly loadLocalData: () => Promise<AiFeatureLocalData>;
}): ResolveTreatmentSource {
  return async (link, signal) => {
    const { source, isCurrent } = link;
    if (!(await isCurrent(signal))) return null;
    const restored = await restoreRetainedSources(
      [source],
      input.registry,
      await input.loadLocalData(),
    );
    const citation = restored.mapping.get(stableJson(source.reference));
    if (restored.sourceChanged || !citation || !(await isCurrent(signal)))
      return null;
    // Public references without a local registered source cannot be reopened here.
    if (
      citation.sourceKind === 'external_medical' &&
      !input.registry.resolve(citation)
    )
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
