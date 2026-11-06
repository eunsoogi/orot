import type { ToolSourceReference } from '@orot/agent-runtime';
import type { SavedGeneratedResearchSource } from '../diseaseHypotheses/savedSummaries';

/** The public locator stays in its existing research row, not in the event lineage. */
export interface ExternalToolResearch {
  readonly kind: 'external_research';
  readonly reference: ToolSourceReference;
  readonly research: SavedGeneratedResearchSource;
}

export function isExternalToolResearch(
  value: unknown,
): value is ExternalToolResearch {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value as { kind?: unknown }).kind === 'external_research',
  );
}

export function sameToolSource(a: ToolSourceReference, b: ToolSourceReference) {
  return (
    a.sourceKind === b.sourceKind &&
    a.sourceId === b.sourceId &&
    a.sourceRevision === b.sourceRevision &&
    a.evidenceId === b.evidenceId &&
    a.evidenceRevision === b.evidenceRevision
  );
}

/** Drop unknown fields from stored lineage before writing or reusing it. */
export function projectExternalToolResearch(
  item: ExternalToolResearch,
  source: SavedGeneratedResearchSource,
): ExternalToolResearch {
  const ref = item.reference;
  const research = source.reference;
  return {
    kind: 'external_research',
    reference: {
      sourceKind: ref.sourceKind,
      sourceId: ref.sourceId,
      sourceRevision: ref.sourceRevision,
      evidenceId: ref.evidenceId,
      evidenceRevision: ref.evidenceRevision,
    },
    research: {
      kind: 'generated_research',
      id: source.id,
      revision: source.revision,
      reference: {
        sourceKind: research.sourceKind,
        sourceId: research.sourceId,
        sourceRevision: research.sourceRevision,
        evidenceId: research.evidenceId,
        evidenceRevision: research.evidenceRevision,
        locator: {
          kind: 'generated_artifact',
          type: (research.locator as { type: string }).type,
        },
        effectiveTime: null,
        reviewState: 'unknown',
      },
    },
  };
}
