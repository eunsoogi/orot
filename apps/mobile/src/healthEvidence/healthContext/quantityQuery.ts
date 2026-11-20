import {
  healthContextCalendarParameter,
  healthContextCalendarSql,
} from './calendarSql';
import {
  localQueryTimestampKey,
  localQueryTimestampKeyExpression,
} from '@orot/storage';
import type { SqlExecutor, SqlValue } from '@orot/storage';
import { currentEvidenceCondition } from '../evidenceCandidateScope';
import type {
  HealthContextDay,
  HealthQuantityDay,
  HealthQuantitySeries,
} from './types';

/** Seek each bound, nonoverlapping local-day interval using the exact timestamp index.
 * This avoids sorting every observation together with calendar boundary events.
 * healthContextDays owns timezone/DST and clipped half-open boundaries; no samples
 * or days are capped. Keep newest-first aggregation order for floating-point
 * totals. The earliest row uses the same timestamp and binary ID ordering.
 * Sensor ranking changes result order, never inclusion.
 */
export async function readHealthQuantityContext(
  executor: SqlExecutor,
  days: readonly HealthContextDay[],
  signal?: AbortSignal,
  family: 'all' | 'measurements' | 'activity' = 'all',
  dataAvailableThrough?: string,
  indexedLatest = false,
  calendarTimestampKeys?: string,
): Promise<{ series: readonly HealthQuantitySeries[]; truncated: boolean }> {
  if (!days.length) throw new RangeError('Invalid health context days.');
  if (signal?.aborted) throw new Error('Health context was cancelled.');
  const parameters: SqlValue[] = [
    calendarTimestampKeys ?? healthContextCalendarParameter(days),
  ];
  const from = localQueryTimestampKey(days[0]!.fromInclusive);
  const to = localQueryTimestampKey(days[days.length - 1]!.toExclusive);
  const at = localQueryTimestampKeyExpression('r.effective_at');
  const ingestion = localQueryTimestampKeyExpression('r.ingested_at');
  const ingestionFilter = dataAvailableThrough ? `AND ${ingestion} <= ?4` : '';
  // The schema distinguishes numeric measurements from narrative clinical facts.
  // Do not silently omit a valid metric merely because its name is not a UI preset.
  const concept = "lower(json_extract(r.payload_json, '$.concept'))";
  const activity = `${concept} IN ('step_count', 'workout_duration')`;
  const familyFilter =
    family === 'all'
      ? ''
      : family === 'activity'
        ? `AND ${activity}`
        : `AND NOT (${activity})`;
  parameters.push(from, to);
  if (dataAvailableThrough)
    parameters.push(localQueryTimestampKey(dataAvailableThrough));
  const normalizedConcept = `CASE ${concept}
            WHEN 'blood_pressure_systolic' THEN 'blood pressure systolic'
            WHEN 'blood_pressure_diastolic' THEN 'blood pressure diastolic'
            WHEN 'weight' THEN 'body_mass'
            ELSE ${concept} END`;
  const unit = "json_extract(r.payload_json, '$.value.unit')";
  const amount = "json_extract(r.payload_json, '$.value.amount')";
  const sensor = `COALESCE(json_extract(r.payload_json, '$.provenance.source.sourceIdentifier'),
                   json_extract(r.payload_json, '$.provenance.origin')) || ':' ||
          COALESCE(json_extract(r.payload_json, '$.provenance.source.productType'),
                   json_extract(r.payload_json, '$.provenance.source.device.model'), '')`;
  const kind = "json_extract(r.payload_json, '$.observationKind')";
  // A measurements-only history read already excludes workout_duration.
  // There, the equivalent kind equality also rejects the clinical kinds.
  const admittedKind =
    indexedLatest && family === 'measurements'
      ? `${kind} = 'measurement'`
      : `${kind} NOT IN ('diagnosis', 'allergy', 'procedure')
          AND (${kind} = 'measurement' OR ${concept} = 'workout_duration')`;
  const admitted = `${admittedKind}
          ${familyFilter}
          AND ${currentEvidenceCondition('health_observation')}
          AND json_extract(r.payload_json, '$.value.kind') = 'quantity'
          AND json_type(r.payload_json, '$.value.amount') IN ('integer', 'real')
          AND json_type(r.payload_json, '$.value.unit') = 'text'`;
  const rankedDaily = `dated AS (
        SELECT id, at, at_key, concept, unit, amount, sensor, date FROM observations
      ), ranked AS (
        SELECT d.*, row_number() OVER (
          PARTITION BY d.date, d.concept, d.unit, d.sensor ORDER BY d.at_key DESC, d.id
        ) AS newest FROM dated d
      ), daily AS MATERIALIZED (
        SELECT date, concept, unit, sensor, count(*) AS samples,
          min(amount) AS minimum, max(amount) AS maximum, avg(amount) AS mean,
          sum(amount) AS total, max(CASE WHEN newest = 1 THEN amount END) AS latest,
          min(CASE WHEN newest = 1 THEN at END) AS last_at,
          min(at_key || hex(id) || '"' || at) AS first_row
        FROM ranked GROUP BY date, concept, unit, sensor
      )`;
  // SUM and AVG use the same SQLite accumulator. Keep its original newest-first
  // input order, then seek only the last sample for each finished daily group.
  const indexedDaily = `totals AS (
        SELECT date, concept, unit, sensor, count(*) AS samples,
          min(amount) AS minimum, max(amount) AS maximum,
          sum(amount ORDER BY at_key DESC, id) AS total,
          max(at_key) AS last_key,
          min(at_key || hex(id) || '"' || at) AS first_row
        FROM observations GROUP BY date, concept, unit, sensor
      ), picked AS MATERIALIZED (
        SELECT t.*, (SELECT r.id FROM health_observations r
          WHERE ${at} = t.last_key AND (${normalizedConcept}) = t.concept
            AND ${unit} = t.unit AND (${sensor}) = t.sensor
            AND ${admitted} ${ingestionFilter}
          ORDER BY r.id LIMIT 1) AS last_id
        FROM totals t
      ), daily AS MATERIALIZED (
        SELECT d.*, CAST(d.total AS REAL) / d.samples AS mean,
          ${amount} AS latest, r.effective_at AS last_at
        FROM picked d JOIN health_observations r ON r.id = d.last_id
      )`;
  // The timestamp terminator and hex ID retain binary tie order. The quote
  // sorts before Hex digits so a prefix ID comes before its longer neighbor.
  const result = await executor.execute(
    `SELECT * FROM (
      WITH days(date, from_key, to_key) AS (${healthContextCalendarSql}),
      observations AS MATERIALIZED (
        SELECT d.date, r.id, r.effective_at AS at, ${at} AS at_key,
          ${normalizedConcept} AS concept, ${unit} AS unit, ${amount} AS amount,
          ${sensor} AS sensor
        FROM days d CROSS JOIN health_observations r
        WHERE ${at} >= d.from_key AND ${at} < d.to_key
          AND ${at} >= ? AND ${at} < ? AND ${admitted} ${ingestionFilter}
      ), ${indexedLatest ? indexedDaily : rankedDaily}, sensor_counts AS (
        SELECT concept, unit, sensor, sum(samples) AS n,
          row_number() OVER (PARTITION BY concept, unit ORDER BY sum(samples) DESC, sensor) AS preference
        FROM daily GROUP BY concept, unit, sensor
      ), selected AS (
        SELECT concept, unit, sensor, row_number() OVER (ORDER BY preference, CASE concept
          WHEN 'blood pressure systolic' THEN 0 WHEN 'blood pressure diastolic' THEN 1
          WHEN 'heart_rate' THEN 2 WHEN 'body_mass' THEN 3 WHEN 'step_count' THEN 4 ELSE 5 END,
          concept, unit, sensor) AS selected_rank FROM sensor_counts
        ORDER BY preference, CASE concept
          WHEN 'blood pressure systolic' THEN 0 WHEN 'blood pressure diastolic' THEN 1
          WHEN 'heart_rate' THEN 2 WHEN 'body_mass' THEN 3 WHEN 'step_count' THEN 4 ELSE 5 END,
          concept, unit, sensor
      )
      SELECT d.date, d.concept, d.unit, d.sensor, d.samples,
        d.minimum, d.maximum, d.mean, d.total, d.latest, d.last_at,
        substr(d.first_row, instr(d.first_row, '"') + 1) AS first_at, s.selected_rank
      FROM daily d JOIN selected s USING (concept, unit, sensor)
      ORDER BY s.selected_rank, d.date
    )`,
    parameters,
  );
  if (signal?.aborted) throw new Error('Health context was cancelled.');
  const series = new Map<
    string,
    { concept: string; unit: string; source: string; days: HealthQuantityDay[] }
  >();
  for (const row of result.rows) {
    if (
      !['date', 'concept', 'unit', 'sensor', 'first_at', 'last_at'].every(
        key => typeof row[key] === 'string',
      )
    )
      throw new Error('Health context returned invalid quantity identity.');
    const numbers = [
      'samples',
      'minimum',
      'maximum',
      'mean',
      'total',
      'latest',
    ] as const;
    if (
      !numbers.every(
        key => typeof row[key] === 'number' && Number.isFinite(row[key]),
      )
    )
      throw new Error('Health context returned invalid quantity statistics.');
    const key = `${row.concept}\u0000${row.unit}\u0000${row.sensor}`;
    const entry = series.get(key) ?? {
      concept: row.concept as string,
      unit: row.unit as string,
      source: row.sensor as string,
      days: [],
    };
    entry.days.push({
      date: row.date as string,
      samples: row.samples as number,
      minimum: row.minimum as number,
      maximum: row.maximum as number,
      mean: row.mean as number,
      sum: row.total as number,
      latest: row.latest as number,
      firstAt: row.first_at as string,
      lastAt: row.last_at as string,
    });
    series.set(key, entry);
  }
  return {
    series: [...series.values()],
    truncated: false,
  };
}
