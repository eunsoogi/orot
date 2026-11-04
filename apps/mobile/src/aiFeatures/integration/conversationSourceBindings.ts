import type { EvidenceReference } from '@orot/agent-runtime';
import type { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { referenceOnly } from '../../diseaseHypotheses/resultValidation';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { fingerprint } from './evidenceUtils';

/** Every reopened local citation remains bound to the saved parent and its current sources. */
export function bindConversationSources(input: {
  readonly citations: readonly EvidenceReference[];
  readonly parentId: string;
  readonly parentRevision: string;
  readonly storage: Pick<
    ReturnType<typeof createConversationArtifactStorage>,
    'read'
  >;
  readonly registry: LocalEvidenceReferenceRegistry;
}): EvidenceReference[] | null {
  const bound: EvidenceReference[] = [];
  for (const citation of input.citations) {
    if (citation.sourceKind === 'external_medical') {
      bound.push(referenceOnly(citation));
      continue;
    }
    const original = input.registry.resolve(citation);
    if (!original) return null;
    const readSource = async (signal: AbortSignal) => {
      if (signal.aborted) return { status: 'unavailable' as const };
      const parent = await input.storage.read(input.parentId);
      if (!parent) return { status: 'missing' as const };
      if (fingerprint(parent) !== input.parentRevision)
        return { status: 'changed' as const };
      const source = await input.registry.readSource(citation, signal);
      const latest = await input.storage.read(input.parentId);
      if (!latest) return { status: 'missing' as const };
      if (fingerprint(latest) !== input.parentRevision)
        return { status: 'changed' as const };
      return signal.aborted ? { status: 'unavailable' as const } : source;
    };
    bound.push(
      referenceOnly(
        input.registry.add({
          reference: referenceOnly(original),
          content: '',
          readSource,
          validate: async signal =>
            (await readSource(signal)).status === 'available',
        }),
      ),
    );
  }
  return bound;
}
