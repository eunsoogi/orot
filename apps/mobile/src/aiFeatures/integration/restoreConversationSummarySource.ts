import type { SavedGeneratedSummarySource } from '../../ragConversation/conversationArtifactSources';
import { referenceOnly } from '../../diseaseHypotheses/resultValidation';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import type { AiFeatureLocalData } from './localData';

/** Rebind a stored generated parent without promoting its interpretation to source fact. */
export async function restoreConversationSummarySource(
  source: SavedGeneratedSummarySource,
  registry: LocalEvidenceReferenceRegistry,
  data: AiFeatureLocalData,
  signal: AbortSignal,
) {
  const discovery = await data.summaryArtifactDiscovery?.(registry);
  if (!discovery || signal.aborted) return null;
  const readSource = async (readSignal: AbortSignal) => {
    const result = await discovery.read(source.id, readSignal);
    if (!result) return { status: 'missing' as const };
    if (
      result.metadata.revision !== source.revision ||
      result.metadata.type !==
        (source.reference.locator as { type?: unknown })?.type ||
      result.sourceStatus === 'changed'
    )
      return { status: 'changed' as const };
    return {
      status: 'available' as const,
      document: {
        sourceKind: 'generated_artifact' as const,
        metadata: result.metadata,
        analysis: result.content,
        sourceStatus: result.sourceStatus,
      },
    };
  };
  const initial = await readSource(signal);
  if (initial.status !== 'available' || signal.aborted) return null;
  return {
    sourceStatus: initial.document.sourceStatus,
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
