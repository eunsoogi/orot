import type { EvidenceReference } from '@orot/agent-runtime';

export type LiteratureIdentity = Pick<
  EvidenceReference,
  'sourceId' | 'sourceRevision' | 'evidenceId' | 'evidenceRevision'
>;

/** Bind every rendered paper to the exact citation revision and reject unrendered paper citations. */
export function literatureCitationsMatch(
  rendered: readonly LiteratureIdentity[],
  citations: readonly EvidenceReference[],
): boolean {
  const papers = citations.filter(
    item =>
      item.sourceKind === 'external_medical' && item.sourceId === 'europe-pmc',
  );
  const key = (item: LiteratureIdentity) =>
    JSON.stringify([
      item.sourceId,
      item.sourceRevision,
      item.evidenceId,
      item.evidenceRevision,
    ]);
  const left = rendered.map(key);
  const right = papers.map(key);
  return (
    left.length === new Set(left).size &&
    right.length === new Set(right).size &&
    left.length === right.length &&
    left.every(id => right.includes(id))
  );
}

/** Omitted mixed-source prose cannot be presented as a complete comparison. */
export function literatureResultPresentation(
  references: readonly LiteratureIdentity[] | undefined,
  citations: readonly EvidenceReference[],
  hasRenderedLocal = false,
) {
  const mixed = Boolean(
    references?.length &&
    !hasRenderedLocal &&
    citations.some(
      item =>
        item.sourceId !== 'europe-pmc' ||
        item.sourceKind !== 'external_medical',
    ),
  );
  return {
    mixed,
    citations: mixed
      ? citations.filter(
          item =>
            item.sourceKind === 'external_medical' &&
            item.sourceId === 'europe-pmc',
        )
      : citations,
  };
}
