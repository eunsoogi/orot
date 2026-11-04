import type { EvidenceReference } from '@orot/agent-runtime';
import type { ConversationArtifactSource } from '../../ragConversation/conversationArtifactSources';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { captureEvidenceSources } from './captureEvidenceSources';
import { RetainedSourceInvalidError } from './retainedSourceError';

/** Capture generated parents as generated artifacts, never as clinical facts. */
export async function captureConversationSources(
  references: readonly EvidenceReference[],
  registry: LocalEvidenceReferenceRegistry,
  signal: AbortSignal,
) {
  const mapping = new Map<string, EvidenceReference>();
  const sources: ConversationArtifactSource[] = [];
  for (const ref of references) {
    const key = JSON.stringify(ref);
    if (mapping.has(key)) continue;
    if (ref.sourceKind !== 'generated_artifact') {
      const captured = await captureEvidenceSources([ref], registry, signal);
      sources.push(...captured.sources);
      mapping.set(key, captured.mapping.get(key)!);
      continue;
    }
    const original = registry.resolve(ref);
    const current = await registry.readSource(ref, signal);
    if (
      !original ||
      current.status === 'missing' ||
      current.status === 'changed'
    )
      throw new RetainedSourceInvalidError(
        'The generated parent changed or was removed.',
      );
    if (current.status !== 'available')
      throw new Error('The generated parent is unavailable.');
    const doc = current.document;
    if (
      doc.sourceKind !== 'generated_artifact' ||
      !(
        ('analysis' in doc &&
          ['symptom_summary', 'disease_possibilities'].includes(
            doc.metadata.type,
          )) ||
        ('conversation' in doc && doc.metadata.type === 'conversation_turn') ||
        ('research' in doc &&
          ['research_publication', 'research_web_explanation'].includes(
            doc.metadata.type,
          ))
      ) ||
      doc.sourceStatus === 'changed' ||
      original.sourceId !== doc.metadata.id ||
      original.evidenceId !== doc.metadata.id ||
      original.sourceRevision !== doc.metadata.revision ||
      original.evidenceRevision !== doc.metadata.revision
    )
      throw new RetainedSourceInvalidError(
        'The generated parent cannot be retained.',
      );
    sources.push({
      kind:
        'research' in doc
          ? 'generated_research'
          : 'conversation' in doc
            ? 'generated_conversation'
            : 'generated_summary',
      reference: original,
      id: doc.metadata.id,
      revision: doc.metadata.revision,
    });
    mapping.set(key, original);
  }
  if (signal.aborted) throw new Error('Saving was cancelled.');
  return { mapping, sources };
}
