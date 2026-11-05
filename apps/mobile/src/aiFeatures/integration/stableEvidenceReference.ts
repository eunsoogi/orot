import type { EvidenceReference } from '@orot/agent-runtime';

export function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stable(record[key])}`)
    .join(',')}}`;
}

/** Registry identity includes the complete locator so aliases cannot be substituted. */
export function stableEvidenceReference(reference: EvidenceReference): string {
  return stable({
    sourceKind: reference.sourceKind,
    sourceId: reference.sourceId,
    sourceRevision: reference.sourceRevision,
    evidenceId: reference.evidenceId,
    evidenceRevision: reference.evidenceRevision,
    locator: reference.locator,
    effectiveTime: reference.effectiveTime,
    ...(reference.unit === undefined ? {} : { unit: reference.unit }),
    reviewState: reference.reviewState,
  });
}
