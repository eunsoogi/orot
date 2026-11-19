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
import {
  readHeartWithWorkoutPrefix,
  type AcquireHeartWorkoutPrefix,
} from './heartWorkoutPrefix';
import type {
  HealthContextDay,
  HealthQuantitySeries,
  HeartRateActivityGroup,
} from './types';

/** Enrich retained heart-rate series from local intervals only. A time overlap is not
 * a HealthKit workout association, active exercise, causation or a clinical judgment.
 * healthContextDays supplies non-overlapping local days; each day seeks the
 * existing concept/time expression index.
 * Exact half-open keys preserve DST, partial days and fractional endpoints without
 * sorting all samples together with calendar boundaries. No sample or day is capped.
 * A sorted timeline carries the maximum prior workout end, avoiding a workout scan per sample.
 * Heart candidates have one consumer, so stream them into the timeline without
 * copying every sample into a second temporary table.
 * At a shared instant, interval ends sort before workout starts and point samples after them:
 * [start, end) intervals exclude an adjacent workout, while points include a workout's start.
 * Workouts can include pauses; unmatched samples do not establish rest or inactivity.
 */
export async function addHeartRateActivityContext(
  executor: SqlExecutor,
  days: readonly HealthContextDay[],
  series: readonly HealthQuantitySeries[],
  signal?: AbortSignal,
  dataAvailableThrough?: string,
  acquirePrefix?: AcquireHeartWorkoutPrefix,
): Promise<readonly HealthQuantitySeries[]> {
  if (!series.some(item => item.concept === 'heart_rate')) return series;
  if (!days.length) throw new RangeError('Invalid health context days.');
  if (signal?.aborted) throw new Error('Health context was cancelled.');
  const from = localQueryTimestampKey(days[0]!.fromInclusive);
  const to = localQueryTimestampKey(days.at(-1)!.toExclusive);
  const at = localQueryTimestampKeyExpression('r.effective_at');
  const end = localQueryTimestampKeyExpression(
    "json_extract(r.payload_json, '$.endedAt')",
  );
  const ingestion = localQueryTimestampKeyExpression('r.ingested_at');
  const cutoff = dataAvailableThrough ? `AND ${ingestion} <= ?` : '';
  const calendar = healthContextCalendarParameter(days);
  const through: SqlValue[] = dataAvailableThrough
    ? [localQueryTimestampKey(dataAvailableThrough)]
    : [];
  const workoutBindings = [to, from, ...through];
  const heartBindings = [from, to, ...through];
  const workoutsSql = `
      SELECT ${at} AS start_key, ${end} AS end_key
      FROM health_observations r
      WHERE json_extract(r.payload_json, '$.observationKind') NOT IN ('diagnosis', 'allergy', 'procedure')
        AND json_extract(r.payload_json, '$.concept') = 'workout_duration'
        AND ${currentEvidenceCondition('health_observation')}
        AND ${at} < ? AND ${end} > ? AND ${end} > ${at} ${cutoff}
    `;
  const heartSql = `
      SELECT ${at} AS start_key, ${end} AS end_key,
        json_extract(r.payload_json, '$.value.unit') AS unit,
        json_extract(r.payload_json, '$.value.amount') AS amount,
        COALESCE(json_extract(r.payload_json, '$.provenance.source.sourceIdentifier'),
          json_extract(r.payload_json, '$.provenance.origin')) || ':' ||
        COALESCE(json_extract(r.payload_json, '$.provenance.source.productType'),
          json_extract(r.payload_json, '$.provenance.source.device.model'), '') AS sensor, d.date AS date
      FROM days d CROSS JOIN health_observations r
      WHERE json_extract(r.payload_json, '$.observationKind') NOT IN ('diagnosis', 'allergy', 'procedure')
        AND json_extract(r.payload_json, '$.concept') = 'heart_rate'
        AND ${currentEvidenceCondition('health_observation')}
        AND ${at} >= d.from_key AND ${at} < d.to_key AND ${at} >= ? AND ${at} < ? ${cutoff}
        AND json_extract(r.payload_json, '$.value.kind') = 'quantity'
        AND json_type(r.payload_json, '$.value.amount') IN ('integer', 'real')
        AND json_type(r.payload_json, '$.value.unit') = 'text'
    `;
  const releasePrefix = acquirePrefix ? await acquirePrefix() : undefined;
  const result = releasePrefix
    ? await readHeartWithWorkoutPrefix(executor, releasePrefix, {
        calendarSql: healthContextCalendarSql,
        calendar,
        workoutsSql,
        workoutBindings,
        heartSql,
        heartBindings,
        to,
      })
    : await executor.execute(
        `SELECT * FROM (
    WITH days(date, from_key, to_key) AS MATERIALIZED (${healthContextCalendarSql}),
    workouts AS MATERIALIZED (${workoutsSql}),
    heart AS NOT MATERIALIZED (${heartSql}), events AS (
      SELECT h.*, CASE WHEN h.end_key > h.start_key THEN h.end_key ELSE h.start_key END AS event_key,
        CASE WHEN h.end_key > h.start_key THEN 0 ELSE 2 END AS event_order,
        NULL AS workout_end FROM heart h
      UNION ALL
      SELECT NULL, NULL, NULL, NULL, NULL, NULL, start_key, 1, end_key FROM workouts
    ), timeline AS (
      SELECT start_key, end_key, unit, amount, sensor, date, event_order, max(workout_end) OVER (
        ORDER BY event_key, event_order ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS latest_workout_end FROM events e
    ), classified AS (
      SELECT h.*,
        CASE WHEN h.end_key IS NULL OR h.end_key < h.start_key OR h.end_key > ?
          OR NOT EXISTS (SELECT 1 FROM workouts) THEN 'unknown'
        WHEN latest_workout_end > h.start_key THEN 'workout_overlap'
        ELSE 'no_recorded_workout_overlap' END AS context
      FROM timeline h WHERE event_order != 1
    )
    SELECT date, unit, sensor, context, count(*) AS samples,
      min(amount) AS minimum, max(amount) AS maximum
    FROM classified GROUP BY date, unit, sensor, context
  )`,
        [calendar, ...workoutBindings, ...heartBindings, to],
      );
  if (signal?.aborted) throw new Error('Health context was cancelled.');
  const groups = new Map<string, HeartRateActivityGroup[]>();
  for (const row of result.rows) {
    if (
      !['date', 'unit', 'sensor'].every(key => typeof row[key] === 'string') ||
      !['unknown', 'workout_overlap', 'no_recorded_workout_overlap'].includes(
        String(row.context),
      ) ||
      !['samples', 'minimum', 'maximum'].every(
        key => typeof row[key] === 'number' && Number.isFinite(row[key]),
      )
    )
      throw new Error(
        'Health context returned invalid heart activity statistics.',
      );
    const key = JSON.stringify([row.date, row.unit, row.sensor]);
    const items = groups.get(key) ?? [];
    items.push({
      context: row.context as HeartRateActivityGroup['context'],
      samples: row.samples as number,
      minimum: row.minimum as number,
      maximum: row.maximum as number,
    });
    groups.set(key, items);
  }
  return series.map(item =>
    item.concept !== 'heart_rate'
      ? item
      : {
          ...item,
          days: item.days.map(day => ({
            ...day,
            activityContext:
              groups.get(JSON.stringify([day.date, item.unit, item.source])) ??
              [],
          })),
        },
  );
}
