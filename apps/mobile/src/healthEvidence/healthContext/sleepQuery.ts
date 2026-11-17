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
import type { HealthContextDay, HealthSleepDay } from './types';

/** Merge overlapping intervals before duration math; codes are never sleep counts.
 * Filter and decode observations once, then clip against predecoded calendar days.
 * Unlike point samples, an interval may span several days. Materialize clipped
 * samples once for both stage unions without changing the existing Julian precision. */
export async function readHealthSleepContext(
  executor: SqlExecutor,
  days: readonly HealthContextDay[],
  signal?: AbortSignal,
  dataAvailableThrough?: string,
): Promise<{
  days: readonly HealthSleepDay[];
  unsupportedCategories: boolean;
}> {
  if (!days.length) throw new RangeError('Invalid sleep context days.');
  if (signal?.aborted) throw new Error('Health context was cancelled.');
  const parameters: SqlValue[] = [
    healthContextCalendarParameter(days, 'instant'),
  ];
  parameters.push(
    localQueryTimestampKey(days.at(-1)!.toExclusive),
    localQueryTimestampKey(days[0]!.fromInclusive),
  );
  const ingestion = localQueryTimestampKeyExpression('r.ingested_at');
  const ingestionFilter = dataAvailableThrough ? `AND ${ingestion} <= ?` : '';
  if (dataAvailableThrough)
    parameters.push(localQueryTimestampKey(dataAvailableThrough));
  const fromKey = localQueryTimestampKeyExpression('r.effective_at');
  const toKey = localQueryTimestampKeyExpression(
    "json_extract(r.payload_json, '$.endedAt')",
  );
  const result = await executor.execute(
    `SELECT * FROM (
    WITH calendar(date, from_at, to_at) AS (${healthContextCalendarSql}),
    days AS MATERIALIZED (
      SELECT date, julianday(from_at) AS from_at, julianday(to_at) AS to_at FROM calendar
    ), observations AS MATERIALIZED (
      SELECT julianday(r.effective_at) AS start,
        julianday(json_extract(r.payload_json, '$.endedAt')) AS finish,
        CASE json_extract(r.payload_json, '$.value.text')
          WHEN '0' THEN 'inBed' WHEN 'inBed' THEN 'inBed'
          WHEN '1' THEN 'asleepUnspecified' WHEN 'asleepUnspecified' THEN 'asleepUnspecified'
          WHEN '2' THEN 'awake' WHEN 'awake' THEN 'awake'
          WHEN '3' THEN 'asleepCore' WHEN 'asleepCore' THEN 'asleepCore'
          WHEN '4' THEN 'asleepDeep' WHEN 'asleepDeep' THEN 'asleepDeep'
          WHEN '5' THEN 'asleepREM' WHEN 'asleepREM' THEN 'asleepREM'
          ELSE 'unsupported' END AS stage
      FROM health_observations r
      WHERE json_extract(r.payload_json, '$.observationKind') NOT IN ('diagnosis', 'allergy', 'procedure')
        AND json_extract(r.payload_json, '$.concept') IN ('HKCategoryTypeIdentifierSleepAnalysis', 'sleep')
        AND ${currentEvidenceCondition('health_observation')}
        AND ${fromKey} < ? AND ${toKey} > ?
        ${ingestionFilter}
    ), samples AS MATERIALIZED (
      SELECT d.date, max(o.start, d.from_at) * 86400 AS start,
        min(o.finish, d.to_at) * 86400 AS finish, o.stage
      FROM observations o JOIN days d ON o.start < d.to_at AND o.finish > d.from_at
    ), intervals AS (
      SELECT * FROM samples WHERE finish > start
      UNION ALL SELECT date, start, finish, 'all_asleep' AS stage FROM samples
        WHERE stage IN ('asleepUnspecified', 'asleepCore', 'asleepDeep', 'asleepREM') AND finish > start
    ), previous AS (
      SELECT *, max(finish) OVER (PARTITION BY date, stage ORDER BY start, finish
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS previous_end FROM intervals
    ), numbered AS (
      SELECT *, sum(CASE WHEN previous_end IS NULL OR start > previous_end THEN 1 ELSE 0 END)
        OVER (PARTITION BY date, stage ORDER BY start, finish ROWS UNBOUNDED PRECEDING) AS island
      FROM previous
    ), merged AS (
      SELECT date, stage, island, min(start) AS start, max(finish) AS finish, count(*) AS samples
      FROM numbered GROUP BY date, stage, island
    )
    SELECT date, stage, round(sum(finish - start), 3) AS seconds, sum(samples) AS samples
    FROM merged GROUP BY date, stage ORDER BY date, stage
  )`,
    parameters,
  );
  if (signal?.aborted) throw new Error('Health context was cancelled.');
  const byDay = new Map<
    string,
    {
      date: string;
      asleepSeconds: number;
      stages: Record<string, number>;
      overlappingStageSeconds: number;
      sampleCount: number;
    }
  >();
  let unsupportedCategories = false;
  for (const row of result.rows) {
    if (
      typeof row.date !== 'string' ||
      typeof row.stage !== 'string' ||
      typeof row.seconds !== 'number' ||
      !Number.isFinite(row.seconds) ||
      row.seconds < 0 ||
      typeof row.samples !== 'number' ||
      !Number.isSafeInteger(row.samples) ||
      row.samples < 1
    )
      throw new Error('Health context returned invalid sleep statistics.');
    const day = byDay.get(row.date) ?? {
      date: row.date,
      asleepSeconds: 0,
      stages: {},
      overlappingStageSeconds: 0,
      sampleCount: 0,
    };
    if (row.stage === 'all_asleep') day.asleepSeconds = row.seconds;
    else {
      day.stages[row.stage] = row.seconds;
      day.sampleCount += row.samples;
      unsupportedCategories ||= row.stage === 'unsupported';
    }
    byDay.set(row.date, day);
  }
  for (const day of byDay.values()) {
    const stageSeconds = Object.entries(day.stages).reduce(
      (sum, [stage, seconds]) =>
        sum + (stage.startsWith('asleep') ? seconds : 0),
      0,
    );
    day.overlappingStageSeconds = Math.max(
      0,
      Math.round((stageSeconds - day.asleepSeconds) * 1000) / 1000,
    );
  }
  return { days: [...byDay.values()], unsupportedCategories };
}
