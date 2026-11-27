import { readVerifiedBoundToolSource } from './verifiedBoundToolRead';
import type { ToolSourceReference } from '@orot/agent-runtime';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';

/** Resolve the actual opener reference only after checking its call and research snapshot. */
export async function resolveConversationToolSource(
  registry: LocalEvidenceReferenceRegistry,
  reference: ToolSourceReference,
  signal: AbortSignal,
  scope?: import('./toolReferenceIndex').ToolCallScope,
) {
  const alias =
    reference.sourceKind === 'external_medical'
      ? scope && registry.toolReferences.findResearch(reference, scope, true)
      : registry.resolveToolReference(reference);
  if (!alias) return undefined;
  const read = await readVerifiedBoundToolSource(
    registry,
    alias,
    signal,
    reference.sourceKind === 'external_medical' && scope
      ? 'public-web'
      : reference.sourceKind === 'personal_record'
        ? 'personal'
        : undefined,
  );
  if (read.status !== 'available') return undefined;
  if (reference.sourceKind !== 'external_medical') return alias;
  return read.document.sourceKind === 'generated_artifact' &&
    'research' in read.document
    ? read.document.sources.find(
        source => source.sourceKind === 'external_medical',
      )
    : undefined;
}
