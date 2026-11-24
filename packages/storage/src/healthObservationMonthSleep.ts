import {
  healthObservationChartSourceExpression,
  healthObservationMonthBoundaries,
  maxHealthObservationMonthBuckets,
  type HealthObservationMonthWindow,
} from './healthObservationMonthQuantity';
import { healthObservationPagePredicate } from './healthObservationPageFilter';
import type { SqlExecutor, SqlValue } from './sql';

export interface HealthObservationSleepBucket {
  readonly effectiveAt: string;
  readonly source: string;
  readonly minutes: number;
}

const milliseconds = (field: string) => `ROUND((julianday(${field}) - 2440587.5) * 86400000)`;
const finish = milliseconds("json_extract(payload_json, '$.endedAt')");
const start = milliseconds('effective_at');

/** Clip overlapping asleep segments to the local-day/window edges and union
 * them in SQLite. Never sum overlapping stages, gaps, or unlike source lines. */
export async function readHealthObservationMonthSleep(
  executor: SqlExecutor,
  window: HealthObservationMonthWindow,
): Promise<readonly HealthObservationSleepBucket[]> {
  const days = healthObservationMonthBoundaries(window);
  const to = Date.parse(window.toInclusive);
  if (days[0] && Date.parse(days[0].effectiveAt) === to) return [];
  const scope = healthObservationPagePredicate(
    { category: 'sleep', toInclusive: window.toInclusive },
    null,
  );
  const bindings: SqlValue[] = days.flatMap((day, index) => [
    day.effectiveAt,
    Date.parse(day.effectiveAt),
    days[index + 1] ? Date.parse(days[index + 1]!.effectiveAt) : to,
  ]);
  const result = await executor.execute(
    `SELECT bucket_at, source, SUM(finish - MAX(start, COALESCE(prior_finish, start))) / 60000.0 AS minutes
     FROM (
       SELECT bucket_at, source, start, finish, MAX(finish) OVER (
         PARTITION BY bucket_at, source ORDER BY start, finish
         ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
       ) AS prior_finish
       FROM (
         SELECT bucket_at, source, MAX(start_ms, day_start) AS start, MIN(end_ms, day_end) AS finish
         FROM (SELECT ? AS bucket_at, ? AS day_start, ? AS day_end
           ${days
             .slice(1)
             .map(() => 'UNION ALL SELECT ?, ?, ?')
             .join(' ')}) AS days
         JOIN (
           SELECT ${start} AS start_ms, ${finish} AS end_ms,
             ${healthObservationChartSourceExpression} AS source
           FROM health_observations
           WHERE ${scope.where} AND ${finish} > ?
             AND json_extract(payload_json, '$.value.kind') = 'text'
             AND json_extract(payload_json, '$.value.text') IN (
               '1', '3', '4', '5', 'asleepUnspecified', 'asleepCore', 'asleepDeep', 'asleepREM'
             )
         ) AS measured ON start_ms < day_end AND end_ms > day_start
       ) AS clipped
       WHERE finish > start
     ) AS union_ranges
     WHERE prior_finish IS NULL OR finish > prior_finish
     GROUP BY bucket_at, source ORDER BY bucket_at, source LIMIT ?`,
    [
      ...bindings,
      ...scope.parameters,
      Date.parse(window.fromInclusive),
      maxHealthObservationMonthBuckets + 1,
    ],
  );
  if (result.rows.length > maxHealthObservationMonthBuckets)
    throw new Error('Too many independent sleep chart buckets.');
  return result.rows.map((row) => {
    const { bucket_at, source, minutes } = row;
    if (
      typeof bucket_at !== 'string' ||
      typeof source !== 'string' ||
      typeof minutes !== 'number' ||
      !Number.isFinite(minutes) ||
      minutes <= 0
    )
      throw new Error('Invalid measured sleep chart bucket.');
    return { effectiveAt: bucket_at, source, minutes };
  });
}
