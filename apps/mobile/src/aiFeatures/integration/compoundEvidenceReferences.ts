import type { EvidenceReference } from '@orot/agent-runtime';

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Expand only the app's bounded, flat overview locator. Every member still passes the ordinary deletion guard. */
export function compoundEvidenceReferences(
  reference: EvidenceReference,
): readonly EvidenceReference[] | undefined {
  const locator = reference.locator;
  if (
    reference.sourceKind !== 'personal_record' ||
    !object(locator) ||
    locator.kind !== 'health_overview'
  )
    return [reference];
  const values = locator.references;
  if (!Array.isArray(values) || !values.length || values.length > 32)
    return undefined;
  const references: EvidenceReference[] = [];
  for (const value of values) {
    if (
      !object(value) ||
      value.sourceKind !== 'personal_record' ||
      !['sourceId', 'sourceRevision', 'evidenceId', 'evidenceRevision'].every(
        field => typeof value[field] === 'string' && value[field].length > 0,
      ) ||
      !['reviewed', 'unreviewed', 'unknown'].includes(
        String(value.reviewState),
      ) ||
      !(
        value.effectiveTime === null || typeof value.effectiveTime === 'string'
      ) ||
      !object(value.locator) ||
      !['local_record', 'structured_record'].includes(
        String(value.locator.kind),
      )
    )
      return undefined;
    references.push(value as unknown as EvidenceReference);
  }
  return references;
}
