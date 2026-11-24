import { isAppleDerivedHeartRateCategory } from './appleDerivedHeartRate';
import { TimestampSchema } from '@orot/domain';
import {
  healthObservationCategoryScope,
  type HealthObservationPageCategory,
} from './healthObservationPageFilter';
import { localQueryTimestampKey, localQueryTimestampKeyExpression } from './localQueryTimestamp';
import type { SqlExecutor, SqlValue } from './sql';

export interface HealthObservationMonthWindow {
  readonly fromInclusive: string;
  readonly toInclusive: string;
}
export interface HealthObservationQuantityBucket {
  readonly effectiveAt: string;
  readonly concept: string;
  readonly unit: string;
  readonly source: string;
  readonly sampleCount: number;
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly sum: number;
}

export const maxHealthObservationMonthBuckets = 1024;
const maxWindowMs = 32 * 24 * 60 * 60 * 1000;
const sortTime = localQueryTimestampKeyExpression('effective_at');
const payload = (path: string) => `json_extract(payload_json, '$.${path}')`;
const sourceId = payload('provenance.source.sourceIdentifier');
const knownSource = `${payload('provenance.source.system')} IS NOT NULL
  AND ${sourceId} IS NOT NULL`;
export const healthObservationChartSourceExpression = `json_array(${[
  payload('provenance.origin'),
  payload('provenance.source.system'),
  `CASE WHEN ${knownSource} THEN ${sourceId} ELSE id END`,
  payload('provenance.source.productType'),
  payload('provenance.source.device.manufacturer'),
  payload('provenance.source.device.model'),
  `CASE WHEN ${knownSource} THEN 'source' ELSE 'record' END`,
].join(', ')})`;

/** The validated rolling window is shared with detail pages; partition by the
 * viewing device's civil midnight without assuming all local days are 24h. */
export function healthObservationMonthBoundaries(window: HealthObservationMonthWindow) {
  const from = TimestampSchema.parse(window.fromInclusive);
  const to = TimestampSchema.parse(window.toInclusive);
  const start = Date.parse(from),
    end = Date.parse(to);
  if (end - start > maxWindowMs || localQueryTimestampKey(from) > localQueryTimestampKey(to))
    throw new Error('A bounded health chart month is required.');
  const days: { effectiveAt: string; lower: string; upper: string }[] = [];
  const cursor = new Date(start);
  let lower = localQueryTimestampKey(from);
  while (cursor.getTime() <= end) {
    const next = new Date(cursor);
    next.setHours(24, 0, 0, 0);
    if (next.getTime() <= cursor.getTime() || days.length === 34)
      throw new Error('Health chart day partitions are invalid.');
    const last = next.getTime() > end;
    const upper = last
      ? localQueryTimestampKey(to) + '~'
      : localQueryTimestampKey(next.toISOString());
    days.push({ effectiveAt: cursor.toISOString(), lower, upper });
    if (last) break;
    lower = upper;
    cursor.setTime(next.getTime());
  }
  return days;
}

/** One already-admitted Apple measurement can represent multiple exact samples.
 * Expand only complete same-source intervals whose neighbors do not overlap or
 * touch. Otherwise keep the original reported scalar as one reading. */
function sampledDerivedQuantitySql(measures: string) {
  const count = payload('heartRateSampleSummary.count');
  const min = payload('heartRateSampleSummary.minimum');
  const max = payload('heartRateSampleSummary.maximum');
  const mean = payload('heartRateSampleSummary.mean');
  const eligible = `typeof(${count}) = 'integer' AND ${count} BETWEEN 2 AND 1000000
    AND typeof(${min}) IN ('integer', 'real') AND typeof(${max}) IN ('integer', 'real')
    AND ${min} > 0 AND ${min} <= amount AND ${max} >= amount
    AND typeof(${mean}) IN ('integer', 'real') AND ${mean} = amount
    AND nullif(${sourceId}, '') IS NOT NULL AND ${payload('observationKind')} = 'measurement'
    AND interval_end >= at_key AND interval_end < upper_key`;
  return `SELECT * FROM (WITH measures AS MATERIALIZED (${measures}),
    neighbors AS (
      SELECT *, max(COALESCE(interval_end, at_key)) OVER (
        PARTITION BY bucket_at, concept, unit, source ORDER BY at_key, id
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ) AS preceding_end,
      lead(at_key) OVER (PARTITION BY bucket_at, concept, unit, source ORDER BY at_key, id) AS following_start
      FROM measures
    ), amounts AS (
      SELECT *, (${eligible}) AND (preceding_end IS NULL OR preceding_end < at_key)
        AND (following_start IS NULL OR following_start > interval_end) AS count_safe
      FROM neighbors
    ), samples AS (
      SELECT bucket_at, concept, unit, source, amount,
        CASE WHEN count_safe THEN ${count} ELSE 1 END AS weight,
        CASE WHEN count_safe THEN ${min} ELSE amount END AS low,
        CASE WHEN count_safe THEN ${max} ELSE amount END AS high
      FROM amounts
    )
    SELECT bucket_at, concept, unit, source, SUM(weight) AS sample_count,
      MIN(low) AS min, MAX(high) AS max, SUM(CAST(amount AS REAL) * weight) / SUM(weight) AS mean,
      SUM(CAST(amount AS REAL) * weight) AS total
    FROM samples GROUP BY bucket_at, concept, unit, source
    ORDER BY bucket_at, concept, unit, source LIMIT ?)`;
}

/** SQLite sees every matching sample in the bounded month; JS gets at most
 * 1024 grouped results, not an unbounded raw observation or newest-page sample.
 * Match the same indexed category/origin predicates as detail paging. */
export async function readHealthObservationMonthQuantity(
  executor: SqlExecutor,
  category: HealthObservationPageCategory,
  window: HealthObservationMonthWindow,
): Promise<readonly HealthObservationQuantityBucket[]> {
  const days = healthObservationMonthBoundaries(window);
  const scope = healthObservationCategoryScope(category);
  const amount = payload('value.amount');
  const unitSql = payload('value.unit');
  const conceptSql = payload('concept');
  const bind: SqlValue[] = days.flatMap((day) => [day.effectiveAt, day.lower, day.upper]);
  const observations = `FROM (SELECT ? AS bucket_at, ? AS lower_key, ? AS upper_key
       ${days
         .slice(1)
         .map(() => 'UNION ALL SELECT ?, ?, ?')
         .join(' ')}) AS days
     CROSS JOIN health_observations
     WHERE ${scope.where} AND (${sortTime}) >= lower_key AND (${sortTime}) < upper_key
       AND ${payload('value.kind')} = 'quantity'
       AND typeof(${amount}) IN ('integer', 'real') AND typeof(${unitSql}) = 'text'`;
  const projection = `bucket_at, ${conceptSql} AS concept, ${unitSql} AS unit,
    ${healthObservationChartSourceExpression} AS source`;
  const sql = isAppleDerivedHeartRateCategory(category)
    ? sampledDerivedQuantitySql(`SELECT ${projection}, id, payload_json, upper_key, (${sortTime}) AS at_key,
        ${localQueryTimestampKeyExpression(payload('endedAt'))} AS interval_end, ${amount} AS amount ${observations}`)
    : `SELECT ${projection},
         COUNT(*) AS sample_count, MIN(${amount}) AS min, MAX(${amount}) AS max,
         AVG(${amount}) AS mean, SUM(CAST(${amount} AS REAL)) AS total
       ${observations}
       GROUP BY bucket_at, concept, unit, source
       ORDER BY bucket_at, concept, unit, source LIMIT ?`;
  const result = await executor.execute(sql, [
    ...bind,
    ...scope.parameters,
    maxHealthObservationMonthBuckets + 1,
  ]);
  if (result.rows.length > maxHealthObservationMonthBuckets)
    throw new Error('Too many independent health chart buckets.');
  return result.rows.map((row) => {
    const { bucket_at, concept, unit, source, sample_count, min, max, mean, total } = row;
    if (
      typeof bucket_at !== 'string' ||
      typeof concept !== 'string' ||
      typeof unit !== 'string' ||
      typeof source !== 'string' ||
      typeof sample_count !== 'number' ||
      !Number.isSafeInteger(sample_count) ||
      sample_count < 1 ||
      typeof min !== 'number' ||
      typeof max !== 'number' ||
      typeof mean !== 'number' ||
      typeof total !== 'number' ||
      ![min, max, mean, total].every(Number.isFinite)
    )
      throw new Error('Invalid measured health chart bucket.');
    return {
      effectiveAt: bucket_at,
      concept,
      unit,
      source,
      sampleCount: sample_count,
      min,
      max,
      mean,
      sum: total,
    };
  });
}
