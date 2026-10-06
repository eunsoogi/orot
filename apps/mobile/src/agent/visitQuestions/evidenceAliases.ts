import type {
  VisitQuestionEvidenceBatch,
  VisitQuestionEvidenceItem,
} from './taskContract';

type EvidenceIdentity = Pick<
  VisitQuestionEvidenceItem,
  | 'sourceKind'
  | 'sourceId'
  | 'sourceRevision'
  | 'evidenceId'
  | 'evidenceRevision'
>;

function identityKey(value: EvidenceIdentity): string {
  return [
    value.sourceKind,
    value.sourceId,
    value.sourceRevision,
    value.evidenceId,
    value.evidenceRevision,
  ].join('\u0000');
}

/** Replaces storage identifiers and locators before a shared runtime builds provider messages. */
export function createVisitQuestionEvidenceAliases(
  original: VisitQuestionEvidenceBatch,
) {
  const sourceAliases = new Map<string, string>();
  const sourceRevisionAliases = new Map<string, string>();
  const aliasToOriginal = new Map<string, VisitQuestionEvidenceItem>();
  const originalToAlias = new Map<string, VisitQuestionEvidenceItem>();

  const aliasSource = (sourceKind: string, sourceId: string): string => {
    const key = `${sourceKind}\u0000${sourceId}`;
    const existing = sourceAliases.get(key);
    if (existing) return existing;
    const alias = `source-${sourceAliases.size + 1}`;
    sourceAliases.set(key, alias);
    return alias;
  };

  const aliasSourceRevision = (
    sourceKind: string,
    sourceId: string,
    revision: string,
  ): string => {
    const key = `${sourceKind}\u0000${sourceId}\u0000${revision}`;
    const existing = sourceRevisionAliases.get(key);
    if (existing) return existing;
    const alias = `source-revision-${sourceRevisionAliases.size + 1}`;
    sourceRevisionAliases.set(key, alias);
    return alias;
  };

  const items = original.items.map((item, index) => {
    const evidenceAlias = `evidence-${index + 1}`;
    const alias: VisitQuestionEvidenceItem = {
      ...item,
      sourceId: aliasSource(item.sourceKind, item.sourceId),
      sourceRevision: aliasSourceRevision(
        item.sourceKind,
        item.sourceId,
        item.sourceRevision,
      ),
      evidenceId: evidenceAlias,
      evidenceRevision: `evidence-revision-${index + 1}`,
      locator: { kind: 'opaque_evidence_reference', id: evidenceAlias },
    };
    aliasToOriginal.set(identityKey(alias), item);
    originalToAlias.set(identityKey(item), alias);
    return alias;
  });
  const coverage = original.coverage.map(item => ({
    ...item,
    searchedSourceIds: item.searchedSourceIds.map(sourceId =>
      aliasSource(item.sourceKind, sourceId),
    ),
  }));

  return {
    batch: {
      items,
      coverage,
      // Conflict contents can include storage identifiers; the role only needs to know one exists.
      conflicts: original.conflicts.map(
        () => 'The evidence contains a material conflict.',
      ),
    } satisfies VisitQuestionEvidenceBatch,
    aliasOf(
      item: VisitQuestionEvidenceItem,
    ): VisitQuestionEvidenceItem | undefined {
      return originalToAlias.get(identityKey(item));
    },
    originalOf(
      reference: EvidenceIdentity,
    ): VisitQuestionEvidenceItem | undefined {
      return aliasToOriginal.get(identityKey(reference));
    },
  };
}
