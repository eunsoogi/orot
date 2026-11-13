import type { EvidenceReference } from '@orot/agent-runtime';
import type { ConversationArtifactSource } from '../../ragConversation/conversationArtifactSources';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { captureEvidenceSources } from './captureEvidenceSources';
import { RetainedSourceInvalidError } from './retainedSourceError';
import { fingerprint, stableJson } from './evidenceUtils';

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
    const original = registry.resolve(ref);
    const locator = original?.locator;
    const location =
      locator && typeof locator === 'object' && !Array.isArray(locator)
        ? (locator as Readonly<Record<string, unknown>>)
        : undefined;
    if (location?.kind === 'conversation_photo') {
      const read = await registry.readSource(ref, signal);
      if (
        !original ||
        read.status !== 'available' ||
        read.document.sourceKind !== 'conversation_photo' ||
        read.document.requestId !== location.requestId ||
        read.document.sourceId !== original.sourceId ||
        read.document.contentHash !== original.sourceRevision ||
        read.document.section.id !== location.sectionId ||
        original.evidenceId !== location.sectionId ||
        original.evidenceRevision !== fingerprint(read.document.section) ||
        !(await registry.revalidateEvidence([ref], signal))
      )
        throw new RetainedSourceInvalidError(
          'The attached photo changed before saving.',
        );
      sources.push({
        kind: 'conversation_photo',
        reference: original,
        requestId: read.document.requestId,
        sectionId: read.document.section.id,
      });
      mapping.set(key, original);
      continue;
    }
    if (ref.sourceKind !== 'generated_artifact') {
      const captured = await captureEvidenceSources([ref], registry, signal);
      sources.push(...captured.sources);
      mapping.set(key, captured.mapping.get(key)!);
      continue;
    }
    const originalGenerated = registry.resolve(ref);
    const current = await registry.readSource(ref, signal);
    if (
      !originalGenerated ||
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
          ['symptom_summary', 'disease_possibilities', 'daily_report'].includes(
            doc.metadata.type,
          )) ||
        ('conversation' in doc && doc.metadata.type === 'conversation_turn') ||
        ('research' in doc &&
          ['research_publication', 'research_web_explanation'].includes(
            doc.metadata.type,
          ))
      ) ||
      doc.sourceStatus === 'changed' ||
      originalGenerated.sourceId !== doc.metadata.id ||
      originalGenerated.evidenceId !== doc.metadata.id ||
      originalGenerated.sourceRevision !== doc.metadata.revision ||
      originalGenerated.evidenceRevision !== doc.metadata.revision
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
      reference: originalGenerated,
      id: doc.metadata.id,
      revision: doc.metadata.revision,
    });
    mapping.set(key, originalGenerated);
  }
  if (signal.aborted) throw new Error('Saving was cancelled.');
  // Multiple dialogue turns can share the same original input; retain it once.
  return {
    mapping,
    sources: [
      ...new Map(sources.map(source => [stableJson(source), source])).values(),
    ],
  };
}
