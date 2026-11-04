import type { SavedGeneratedConversationSource } from '../../ragConversation/conversationArtifactSources';
import { referenceOnly } from '../../diseaseHypotheses/resultValidation';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import type { AiFeatureLocalData } from './localData';
import type { EvidenceReference } from '@orot/agent-runtime';
import type { EvidenceSourceReadResult } from './evidenceSourceDocument';

/** Restore a generated conversation parent through the same validated catalog as discovery. */
export async function restoreConversationParentSource(
  source: SavedGeneratedConversationSource,
  registry: LocalEvidenceReferenceRegistry,
  data: AiFeatureLocalData,
  signal: AbortSignal,
): Promise<{
  reference: EvidenceReference;
  sourceStatus: 'current' | 'unknown';
} | null> {
  const discovery = await data.conversationArtifactDiscovery?.(registry);
  if (!discovery || signal.aborted) return null;
  const readSource = async (
    readSignal: AbortSignal,
  ): Promise<EvidenceSourceReadResult> => {
    const result = await discovery.read(source.id, readSignal);
    if (!result) return { status: 'missing' as const };
    if (result.metadata.revision !== source.revision)
      return { status: 'changed' as const };
    return {
      status: 'available' as const,
      document: {
        sourceKind: 'generated_artifact' as const,
        metadata: result.metadata,
        conversation: result.content,
        sources: result.sources,
        sourceStatus: result.sourceStatus,
      },
    };
  };
  const initial = await readSource(signal);
  if (
    initial.status !== 'available' ||
    initial.document.sourceKind !== 'generated_artifact' ||
    initial.document.sourceStatus === 'changed' ||
    signal.aborted
  )
    return null;
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
