import type { LocalHealthEvidenceRecord } from '../localEvidenceQueries';

/** Bound relevant candidates before LIMIT. JSON parameters are data, never SQL.
 * Compare every current source-schema field independent of JSON property order;
 * the existing exact full provenance comparison also remains after decoding. */
export function baselineCandidateFilter(
  today: readonly LocalHealthEvidenceRecord[],
) {
  const candidates = today.flatMap(item => {
    if (
      item.kind !== 'health_observation' ||
      item.record.value.kind !== 'quantity'
    )
      return [];
    return [
      {
        concept: item.record.concept,
        unit: item.record.value.unit,
        origin: item.record.provenance.origin,
        source: item.record.provenance.source ?? null,
      },
    ];
  });
  const sourceFields = [
    'system',
    'sourceIdentifier',
    'sourceName',
    'sourceVersion',
    'productType',
    'device.manufacturer',
    'device.model',
    'device.hardwareVersion',
    'device.softwareVersion',
  ];
  const sourceMatch = sourceFields
    .map(
      field =>
        `json_extract(candidate.value, '$.source.${field}') IS json_extract(r.payload_json, '$.provenance.source.${field}')`,
    )
    .join(' AND ');
  return {
    sql: `EXISTS (SELECT 1 FROM json_each(?) candidate WHERE
      json_extract(candidate.value, '$.concept') = json_extract(r.payload_json, '$.concept')
      AND json_extract(candidate.value, '$.unit') = json_extract(r.payload_json, '$.value.unit')
      AND json_extract(candidate.value, '$.origin') = json_extract(r.payload_json, '$.provenance.origin')
      AND ${sourceMatch}
      AND coalesce(json_type(candidate.value, '$.source.device'), 'null') = coalesce(json_type(r.payload_json, '$.provenance.source.device'), 'null'))`,
    parameter: JSON.stringify(candidates),
  };
}

/** Observed events use definition identity; taken/administered/missed use assertion
 * identity. Never match medication display names or infer prescription adherence. */
export const doseHistorySqlKey = `CASE WHEN json_extract(r.payload_json, '$.eventKind') = 'observed'
  THEN 'definition:' || json_extract(r.payload_json, '$.medicationDefinitionId')
  ELSE 'assertion:' || json_extract(r.payload_json, '$.medicationAssertionId') END`;

/** Diversity selection is intentionally bounded, not a representative clinical sample. */
export function baselineCandidateOrder(at: string) {
  return `row_number() OVER (PARTITION BY json_extract(r.payload_json, '$.concept'),
    json_extract(r.payload_json, '$.value.unit'), json_extract(r.payload_json, '$.provenance.origin'),
    json_extract(r.payload_json, '$.provenance.source') ORDER BY ${at} DESC, r.id),
    ${at} DESC, r.id`;
}
