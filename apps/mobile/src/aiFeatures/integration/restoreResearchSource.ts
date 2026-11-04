import type { SavedGeneratedResearchSource } from '../../diseaseHypotheses/savedSummaries';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { referenceOnly } from '../../diseaseHypotheses/resultValidation';
import { readResearchSource } from './researchSourceReader';

/** Rebind a research parent only while its stored snapshot and revision still match. */
export async function restoreResearchSource(
  source: SavedGeneratedResearchSource,
  registry: LocalEvidenceReferenceRegistry,
  data: AiFeatureLocalData,
  signal: AbortSignal,
) {
  const discovery = await data.researchArtifactDiscovery?.();
  if (!discovery || signal.aborted) return null;
  const readSource = async (readSignal: AbortSignal) => {
    const result = await readResearchSource(
      data,
      registry,
      source.id,
      source.revision,
      readSignal,
    );
    if (
      result.status === 'available' &&
      result.document.sourceKind === 'generated_artifact' &&
      result.document.metadata.type !==
        (source.reference.locator as { type?: unknown }).type
    )
      return { status: 'changed' as const };
    return result;
  };
  if ((await readSource(signal)).status !== 'available' || signal.aborted)
    return null;
  return {
    sourceStatus: 'unknown' as const,
    reference: referenceOnly(
      registry.add({
        reference: source.reference,
        content: '',
        readSource,
        validate: async current =>
          (await readSource(current)).status === 'available',
      }),
    ),
  };
}
