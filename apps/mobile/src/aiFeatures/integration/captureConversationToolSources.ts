import type {
  ConversationToolEvent,
  ToolSourceReference,
} from '@orot/agent-runtime';
import type { ToolLineage } from '../../storage/conversationToolLineage';
import type { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { isPeriodSummarySource } from '../../diseaseHypotheses/savedSummaries';
import { captureConversationSources } from './captureConversationSources';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';

/** Capture source lineage locally; never persist a search input, result text, or opaque locator. */
export async function captureConversationToolSources(
  event: ConversationToolEvent,
  registry: LocalEvidenceReferenceRegistry,
  storage?: Pick<
    ReturnType<typeof createConversationArtifactStorage>,
    'captureFilteredToolPeriod'
  >,
  sessionId?: string,
) {
  const dependencies: ToolLineage[number][] = [];
  const references: ToolSourceReference[] = [];
  for (const source of event.sources) {
    if (source.sourceKind === 'external_medical') {
      const alias = sessionId
        ? registry.toolReferences.findResearch(source, { ...event, sessionId })
        : undefined;
      if (!alias) {
        // Legacy or unretained research remains visible but cannot be opened as a saved source.
        references.push(source);
        continue;
      }
      const captured = await captureConversationSources(
        [alias],
        registry,
        new AbortController().signal,
      );
      const research = captured.sources[0];
      if (
        !research ||
        !('kind' in research) ||
        research.kind !== 'generated_research'
      )
        throw new Error('Tool research source is unavailable.');
      dependencies.push({
        kind: 'external_research',
        reference: source,
        research,
      });
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
    // Resolve the private filter to a data-owned identity; never serialize its text.
    if (
      isPeriodSummarySource(dependency) &&
      dependency.scope.window.doseHistory?.medicationName !== undefined
    ) {
      const document = await registry.readSource(
        alias,
        new AbortController().signal,
      );
      if (
        !storage ||
        document.status !== 'available' ||
        document.document.sourceKind !== 'health_context_period'
      )
        throw new Error('Filtered tool source is unavailable.');
      const saved = await storage.captureFilteredToolPeriod(
        dependency.reference,
        document.document.scope,
        document.document.report,
      );
      const ref = saved.reference;
      references.push({
        sourceKind: ref.sourceKind,
        sourceId: ref.sourceId,
        sourceRevision: ref.sourceRevision,
        evidenceId: ref.evidenceId,
        evidenceRevision: ref.evidenceRevision,
      });
      dependencies.push(saved);
      continue;
    }
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
