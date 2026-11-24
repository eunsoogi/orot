import type { HealthObservation } from '@orot/domain';

const namespaces = {
  resting_heart_rate: 'healthkit:restingHeartRate:',
  walking_heart_rate_average: 'healthkit:walkingHeartRateAverage:',
} as const;

export type AppleDerivedHeartRateCategory = keyof typeof namespaces;
export const appleDerivedHeartRateCategories: readonly AppleDerivedHeartRateCategory[] =
  Object.keys(namespaces) as AppleDerivedHeartRateCategory[];

export function isAppleDerivedHeartRateCategory(
  category: string,
): category is AppleDerivedHeartRateCategory {
  return Object.prototype.hasOwnProperty.call(namespaces, category);
}

/** Match the anchored importer, not a manually named or generic heart-rate row. */
export function classifyAppleDerivedHeartRate(
  observation: HealthObservation,
): AppleDerivedHeartRateCategory | null {
  const { concept, id, value, provenance } = observation;
  return isAppleDerivedHeartRateCategory(concept) &&
    provenance.sourceRecordIds.length === 1 &&
    id === namespaces[concept] + provenance.sourceRecordIds[0] &&
    provenance.origin === 'imported' &&
    provenance.source?.system === 'healthkit' &&
    value.kind === 'quantity' &&
    value.unit === 'count/min'
    ? concept
    : null;
}

/** This exact imported-source prefix reuses the existing local query index. */
export function appleDerivedHeartRatePredicate(category: AppleDerivedHeartRateCategory): string {
  return `json_extract(payload_json, '$.provenance.origin') = 'imported'
    AND json_extract(payload_json, '$.provenance.source.system') = 'healthkit'
    AND json_extract(payload_json, '$.concept') = '${category}'
    AND id GLOB '${namespaces[category]}?*'
    AND json_array_length(payload_json, '$.provenance.sourceRecordIds') = 1
    AND json_extract(payload_json, '$.provenance.sourceRecordIds[0]') = substr(id, ${namespaces[category].length + 1})
    AND json_extract(payload_json, '$.value.kind') = 'quantity'
    AND json_extract(payload_json, '$.value.unit') = 'count/min'`;
}
