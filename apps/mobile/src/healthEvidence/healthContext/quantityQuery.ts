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

const concepts = [
  'blood pressure systolic',
  'blood_pressure_systolic',
  'blood pressure diastolic',
  'blood_pressure_diastolic',
  'heart_rate',
  'body_mass',
  'weight',
  'step_count',
] as const;

/** Materialize the bounded period once and aggregate daily before selecting sensor series.
 * Joining raw observations to both days and selected series made SQLite repeatedly expand JSON/time expressions.
 * Fetch at most thirteen series, using the last only as an overflow indicator; return twelve complete daily series.
 */
export async function readHealthQuantityContext(
  executor: SqlExecutor,
  days: readonly HealthContextDay[],
  signal?: AbortSignal,
  family: 'all' | 'measurements' | 'activity' = 'all',
): Promise<{ series: readonly HealthQuantitySeries[]; truncated: boolean }> {
  if (!days.length || days.length > 90)
    throw new RangeError('Invalid health context days.');
  if (signal?.aborted) throw new Error('Health context was cancelled.');
  const parameters: SqlValue[] = days.flatMap(day => [
    day.date,
    localQueryTimestampKey(day.fromInclusive),
    localQueryTimestampKey(day.toExclusive),
  ]);
  const from = localQueryTimestampKey(days[0]!.fromInclusive);
  const to = localQueryTimestampKey(days[days.length - 1]!.toExclusive);
  const at = localQueryTimestampKeyExpression('r.effective_at');
  const selectedConcepts = concepts.filter(
    concept =>
      family === 'all' ||
      (concept === 'step_count'
        ? family === 'activity'
        : family === 'measurements'),
  );
  parameters.push(...selectedConcepts, from, to);
  const result = await executor.execute(
    `SELECT * FROM (
      WITH days(date, from_key, to_key) AS (VALUES ${days.map(() => '(?, ?, ?)').join(', ')}),
      observations AS MATERIALIZED (
        SELECT r.id, r.effective_at AS at, ${at} AS at_key,
          CASE lower(json_extract(r.payload_json, '$.concept'))
            WHEN 'blood_pressure_systolic' THEN 'blood pressure systolic'
            WHEN 'blood_pressure_diastolic' THEN 'blood pressure diastolic'
            WHEN 'weight' THEN 'body_mass'
            ELSE lower(json_extract(r.payload_json, '$.concept')) END AS concept,
          json_extract(r.payload_json, '$.value.unit') AS unit,
          json_extract(r.payload_json, '$.value.amount') AS amount,
          COALESCE(json_extract(r.payload_json, '$.provenance.source.sourceIdentifier'),
                   json_extract(r.payload_json, '$.provenance.origin')) || ':' ||
          COALESCE(json_extract(r.payload_json, '$.provenance.source.productType'),
                   json_extract(r.payload_json, '$.provenance.source.device.model'), '') AS sensor
        FROM health_observations r
        WHERE json_extract(r.payload_json, '$.concept') IN (${selectedConcepts.map(() => '?').join(', ')})
          AND ${currentEvidenceCondition('health_observation')}
          AND ${at} >= ? AND ${at} < ?
          AND json_extract(r.payload_json, '$.value.kind') = 'quantity'
          AND json_type(r.payload_json, '$.value.amount') IN ('integer', 'real')
          AND json_type(r.payload_json, '$.value.unit') = 'text'
      ), dated AS MATERIALIZED (
        SELECT o.*, (SELECT d.date FROM days d
          WHERE o.at_key >= d.from_key AND o.at_key < d.to_key LIMIT 1) AS date
        FROM observations o
      ), ranked AS (
        SELECT d.*, row_number() OVER (
          PARTITION BY d.date, d.concept, d.unit, d.sensor ORDER BY d.at_key DESC, d.id
        ) AS newest, row_number() OVER (
          PARTITION BY d.date, d.concept, d.unit, d.sensor ORDER BY d.at_key ASC, d.id
        ) AS oldest FROM dated d
      ), daily AS MATERIALIZED (
        SELECT date, concept, unit, sensor, count(*) AS samples,
          min(amount) AS minimum, max(amount) AS maximum, avg(amount) AS mean,
          sum(amount) AS total, max(CASE WHEN newest = 1 THEN amount END) AS latest,
          min(CASE WHEN newest = 1 THEN at END) AS last_at,
          min(CASE WHEN oldest = 1 THEN at END) AS first_at
        FROM ranked GROUP BY date, concept, unit, sensor
      ), sensor_counts AS (
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
          concept, unit, sensor LIMIT 13
      )
      SELECT d.*, s.selected_rank FROM daily d JOIN selected s USING (concept, unit, sensor)
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
    series: [...series.values()].slice(0, 12),
    truncated: series.size > 12,
  };
}
