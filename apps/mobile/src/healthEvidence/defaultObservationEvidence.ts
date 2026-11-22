import type { RecordKind } from '@orot/storage';

const resting = "r.id GLOB 'healthkit:restingHeartRate:*'";
const walking = "r.id GLOB 'healthkit:walkingHeartRateAverage:*'";

/** Do not force a full payload scan just to count the tiny fenced population. */
export function defaultHealthObservationCountSql(): string {
  return `SELECT (SELECT count(*) FROM health_observations) - (
    SELECT count(*) FROM health_observations r WHERE (${resting} OR ${walking})
      AND NOT (${defaultObservationAllowedSql()})
  ) AS total`;
}

/** Exclude only newly admitted Apple-derived rows from default AI evidence.
 * Keep legacy/manual resting samples and raw heart rate unchanged. These fixed
 * namespaces belong to the anchored HealthKit importer, not provider input.
 * Every caller uses the protected row alias r.
 */
export function defaultObservationEvidence(kind: RecordKind): string {
  if (kind !== 'health_observation') return '';
  return `AND ${defaultObservationAllowedSql()}`;
}

/** Quantity aggregation already groups case-normalized concepts. Use its
 * covered expression so the privacy check never loads the underlying payload.
 */
export function defaultQuantityObservationEvidence(): string {
  return `AND ${defaultObservationAllowedSql(
    "lower(json_extract(r.payload_json, '$.concept'))",
  )}`;
}

function defaultObservationAllowedSql(
  concept = "json_extract(r.payload_json, '$.concept')",
): string {
  return `CASE
    WHEN ${resting} THEN ${concept} IS NOT 'resting_heart_rate'
    WHEN ${walking} THEN ${concept} IS NOT 'walking_heart_rate_average'
    ELSE 1
  END`;
}
