/** Round-robin recent samples across exact metric/unit/provenance groups. Keep
 * the existing severe-pressure verification boundary ahead of normal sampling.
 * This intentionally prioritizes safety, not statistical representativeness;
 * sampled records must never be presented as a complete day's distribution. */
export function dailyReportCandidateOrder(kind: string, start: string) {
  if (kind !== 'health_observation') return `${start} DESC, r.id`;
  const concept = "json_extract(r.payload_json, '$.concept')";
  const amount = "json_extract(r.payload_json, '$.value.amount')";
  const severe = `json_extract(r.payload_json, '$.value.kind') = 'quantity'
    AND json_extract(r.payload_json, '$.value.unit') = 'mmHg'
    AND ((${concept} IN ('blood_pressure_systolic', 'blood pressure systolic') AND ${amount} >= 180)
      OR (${concept} IN ('blood_pressure_diastolic', 'blood pressure diastolic') AND ${amount} >= 120))`;
  return `CASE WHEN ${severe} THEN 0 ELSE 1 END,
    row_number() OVER (
      PARTITION BY ${concept}, json_extract(r.payload_json, '$.value.unit'),
        json_extract(r.payload_json, '$.provenance.origin'),
        json_extract(r.payload_json, '$.provenance.source')
      ORDER BY ${start} DESC, r.id
    ), ${start} DESC, r.id`;
}
