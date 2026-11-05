import type { ToolSourceReference } from '@orot/agent-runtime';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';

/** Resolve the actual opener reference only after checking its call and research snapshot. */
export async function resolveConversationToolSource(
  registry: LocalEvidenceReferenceRegistry,
  reference: ToolSourceReference,
  signal: AbortSignal,
) {
  const alias =
    registry.toolResearch(reference) ??
    registry.resolveToolReference(reference);
  if (!alias) return undefined;
  const read = await registry.readSource(alias, signal);
  if (read.status !== 'available') return undefined;
  if (reference.sourceKind !== 'external_medical') return alias;
  return read.document.sourceKind === 'generated_artifact' &&
    'research' in read.document
    ? read.document.sources.find(
        source => source.sourceKind === 'external_medical',
      )
    : undefined;
}
