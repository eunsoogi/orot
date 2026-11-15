import type { HealthObservation } from '@orot/domain';

/**
 * Selects measured examples from one bounded read, never a full-period estimate.
 * Keep endpoints and evenly spaced chronological ranks per concept/unit. Do not
 * average, convert units, infer missing samples, or mutate the stored records.
 */
export function selectHealthRecordPreview(
  observations: readonly HealthObservation[],
): HealthObservation[] {
  const groups = new Map<string, HealthObservation[]>();
  for (const record of observations) {
    if (
      record.value.kind !== 'quantity' ||
      !Number.isFinite(record.value.amount) ||
      !Number.isFinite(Date.parse(record.effectiveAt))
    )
      continue;
    const key = JSON.stringify([record.concept, record.value.unit]);
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }
  return [...groups.values()].flatMap(group => {
    const sorted = [...group].sort(
      (a, b) =>
        Date.parse(a.effectiveAt) - Date.parse(b.effectiveAt) ||
        a.id.localeCompare(b.id),
    );
    if (sorted.length <= 12) return sorted;
    return Array.from(
      { length: 12 },
      (_, index) => sorted[Math.round((index * (sorted.length - 1)) / 11)]!,
    );
  });
}
