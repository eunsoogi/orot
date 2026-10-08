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

export interface VisitQuestionEvidenceAliases {
  readonly batch: VisitQuestionEvidenceBatch;
  aliasBatch(batch: VisitQuestionEvidenceBatch): VisitQuestionEvidenceBatch;
  aliasOf(
    item: VisitQuestionEvidenceItem,
  ): VisitQuestionEvidenceItem | undefined;
  originalOf(
    reference: EvidenceIdentity,
  ): VisitQuestionEvidenceItem | undefined;
}

export function visitQuestionEvidenceIdentityKey(
  value: EvidenceIdentity,
): string {
  return [
    value.sourceKind,
    value.sourceId,
    value.sourceRevision,
    value.evidenceId,
    value.evidenceRevision,
  ].join('\u0000');
}

// Local aliases cannot protect IDs that remain inside JSON record content.
function removeIdentifierFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeIdentifierFields);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(
        ([key]) =>
          !/^(?:id|ids|identifier|identifiers|key|keys)$/iu.test(key) &&
          !/(?:Id|Ids|ID|IDs|Identifier|Identifiers|Key|Keys)$/u.test(key),
      )
      .map(([key, entry]) => [key, removeIdentifierFields(entry)]),
  );
}

function providerEvidenceContent(content: string): string {
  const separator = content.indexOf(': ');
  const trimmedContent = content.trimStart();
  const rawJson =
    separator < 0 &&
    (trimmedContent.startsWith('{') || trimmedContent.startsWith('['));
  if (separator < 0 && !rawJson) return content;
  const kind = rawJson ? '' : content.slice(0, separator);
  const body = rawJson ? content : content.slice(separator + 2);
  if (!body.trimStart().startsWith('{') && !body.trimStart().startsWith('['))
    return content;
  try {
    // Structured chunks are JSON; malformed structured content fails closed instead of leaking raw fields.
    const sanitized = JSON.stringify(removeIdentifierFields(JSON.parse(body)));
    return kind ? `${kind}: ${sanitized}` : sanitized;
  } catch {
    return kind
      ? `${kind}: [structured evidence unavailable]`
      : '[structured evidence unavailable]';
  }
}

/** Replaces storage identifiers and locators before a shared runtime builds provider messages. */
export function createVisitQuestionEvidenceAliases(
  original: VisitQuestionEvidenceBatch,
): VisitQuestionEvidenceAliases {
  const sourceAliases = new Map<string, string>();
  const sourceRevisionAliases = new Map<string, string>();
  const aliasToOriginal = new Map<string, VisitQuestionEvidenceItem>();
  const originalToAlias = new Map<string, VisitQuestionEvidenceItem>();
  let nextEvidenceIndex = 0;

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

  const aliasBatch = (
    batch: VisitQuestionEvidenceBatch,
  ): VisitQuestionEvidenceBatch => {
    const items = batch.items.map(item => {
      const originalKey = visitQuestionEvidenceIdentityKey(item);
      const existing = originalToAlias.get(originalKey);
      if (existing) return existing;
      nextEvidenceIndex += 1;
      const evidenceAlias = `evidence-${nextEvidenceIndex}`;
      const alias: VisitQuestionEvidenceItem = {
        ...item,
        sourceId: aliasSource(item.sourceKind, item.sourceId),
        sourceRevision: aliasSourceRevision(
          item.sourceKind,
          item.sourceId,
          item.sourceRevision,
        ),
        evidenceId: evidenceAlias,
        evidenceRevision: `evidence-revision-${nextEvidenceIndex}`,
        locator: { kind: 'opaque_evidence_reference', id: evidenceAlias },
        content: providerEvidenceContent(item.content),
      };
      aliasToOriginal.set(visitQuestionEvidenceIdentityKey(alias), item);
      originalToAlias.set(originalKey, alias);
      return alias;
    });
    const coverage = batch.coverage.map(item => ({
      ...item,
      searchedSourceIds: item.searchedSourceIds.map(sourceId =>
        aliasSource(item.sourceKind, sourceId),
      ),
    }));

    return {
      items,
      coverage,
      // Conflict messages can contain source identifiers; roles only need a generic notice.
      conflicts: batch.conflicts.map(
        () => 'The evidence contains a material conflict.',
      ),
    };
  };

  const batch = aliasBatch(original);

  return {
    batch,
    aliasBatch,
    aliasOf(
      item: VisitQuestionEvidenceItem,
    ): VisitQuestionEvidenceItem | undefined {
      return originalToAlias.get(visitQuestionEvidenceIdentityKey(item));
    },
    originalOf(
      reference: EvidenceIdentity,
    ): VisitQuestionEvidenceItem | undefined {
      return aliasToOriginal.get(visitQuestionEvidenceIdentityKey(reference));
    },
  };
}
