import type {
  ConversationToolEvent,
  ToolSourceReference,
} from '@orot/agent-runtime';
import type { ConversationArtifactSource } from '../../ragConversation/conversationArtifactSources';
import { isPeriodSummarySource } from '../../diseaseHypotheses/savedSummaries';
import { captureConversationSources } from './captureConversationSources';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';

/** Capture source lineage locally; never persist a search input, result text, or opaque locator. */
export async function captureConversationToolSources(
  event: ConversationToolEvent,
  registry: LocalEvidenceReferenceRegistry,
) {
  const dependencies: ConversationArtifactSource[] = [];
  const references: ToolSourceReference[] = [];
  for (const source of event.sources) {
    if (source.sourceKind === 'external_medical') {
      references.push(source);
      continue;
    }
    const alias = registry.resolveToolReference(source);
    if (!alias) throw new Error('Tool source is unavailable.');
    const captured = await captureConversationSources(
      [alias],
      registry,
      new AbortController().signal,
    );
    const dependency = captured.sources[0];
    if (!dependency) throw new Error('Tool source is unavailable.');
    // The model-supplied filter is private input and cannot enter the durable lineage.
    if (
      isPeriodSummarySource(dependency) &&
      dependency.scope.window.doseHistory?.medicationName !== undefined
    )
      throw new Error(
        'Filtered medication tool sources cannot be retained safely.',
      );
    const ref = dependency.reference;
    const projected = {
      sourceKind: ref.sourceKind,
      sourceId: ref.sourceId,
      sourceRevision: ref.sourceRevision,
      evidenceId: ref.evidenceId,
      evidenceRevision: ref.evidenceRevision,
    };
    references.push(projected);
    const locator = isPeriodSummarySource(dependency)
      ? dependency.scope
      : 'kind' in dependency && dependency.kind.startsWith('generated_')
        ? {
            kind: 'generated_artifact',
            type: (ref.locator as { type: string }).type,
          }
        : null;
    dependencies.push({
      ...dependency,
      reference: {
        ...projected,
        locator: JSON.parse(JSON.stringify(locator)),
        effectiveTime: null,
        reviewState: 'unknown',
      },
    });
  }
  return { event: { ...event, sources: references }, dependencies };
}
