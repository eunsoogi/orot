import type { EvidenceItem, EvidenceReference } from '@orot/agent-runtime';
import { t } from '../i18n';

export type LocalClaimIdentity = Pick<
  EvidenceReference,
  | 'sourceKind'
  | 'sourceId'
  | 'sourceRevision'
  | 'evidenceId'
  | 'evidenceRevision'
>;

/** Every rendered record must have an exact validated citation, and vice versa. */
export function localClaimsMatch(
  rendered: readonly LocalClaimIdentity[],
  citations: readonly EvidenceReference[],
): boolean {
  const records = citations.filter(
    item => item.sourceKind === 'personal_record',
  );
  const key = (item: LocalClaimIdentity) =>
    JSON.stringify([
      item.sourceKind,
      item.sourceId,
      item.sourceRevision,
      item.evidenceId,
      item.evidenceRevision,
    ]);
  const left = rendered.map(key);
  const right = records.map(key);
  return (
    left.length === new Set(left).size &&
    right.length === new Set(right).size &&
    left.length === right.length &&
    left.every(id => right.includes(id))
  );
}

/** Render complete source text only, so model prose cannot alter a personal record. */
export function renderLocalClaims(
  value: unknown,
  items: readonly EvidenceItem[],
): { answer: string; references: LocalClaimIdentity[] } | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > 5)
    return undefined;
  const lines: string[] = [];
  const references: LocalClaimIdentity[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
      return undefined;
    const c = candidate as Record<string, unknown>;
    const matches = items.filter(
      item =>
        item.sourceKind === 'personal_record' &&
        item.sourceRevision === c.sourceRevision &&
        item.evidenceId === c.evidenceId &&
        item.evidenceRevision === c.evidenceRevision,
    );
    if (
      matches.length !== 1 ||
      typeof c.span !== 'string' ||
      !c.span.trim() ||
      c.span !== matches[0]!.content ||
      c.span.length > 2000
    )
      return undefined;
    const item = matches[0]!;
    references.push({
      sourceKind: item.sourceKind,
      sourceId: item.sourceId,
      sourceRevision: item.sourceRevision,
      evidenceId: item.evidenceId,
      evidenceRevision: item.evidenceRevision,
    });
    lines.push(
      t('ragConversation.literature.recordSourceText', { span: c.span }),
    );
  }
  return { answer: lines.join('\n\n'), references };
}
