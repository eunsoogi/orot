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
import type { HealthContextDay, HealthContextReport } from './types';

/** Count local occurrences that existed by cutoff and retain every complete description.
 * Sweep exact occurrence keys with calendar starts instead of evaluating JSON/time
 * expressions for every day-record pair. Starts sort before equal-time entries;
 * the exclusive end check also excludes gaps between supplied calendar windows.
 * As with the reader calendar contract, days are ordered, non-overlapping local dates. */
export async function readHealthSymptomContext(
  executor: SqlExecutor,
  days: readonly HealthContextDay[],
  dataAvailableThrough?: string,
): Promise<HealthContextReport['symptoms']> {
  const occurred =
    "coalesce(json_extract(r.payload_json, '$.startedAt'), r.effective_at)";
  const at = localQueryTimestampKeyExpression(occurred);
  const ingestion = localQueryTimestampKeyExpression('r.ingested_at');
  const ingestionFilter = dataAvailableThrough ? `AND ${ingestion} <= ?` : '';
  if (!days.length) throw new RangeError('Invalid health context days.');
  const parameters: SqlValue[] = [
    healthContextCalendarParameter(days),
    localQueryTimestampKey(days[0]!.fromInclusive),
    localQueryTimestampKey(days.at(-1)!.toExclusive),
  ];
  if (dataAvailableThrough)
    parameters.push(localQueryTimestampKey(dataAvailableThrough));
  const count = await executor.execute(
    `SELECT * FROM (
    WITH days(date, from_key, to_key) AS (${healthContextCalendarSql}),
    occurrences AS MATERIALIZED (
      SELECT ${at} AS at_key FROM symptom_entries r
      WHERE ${at} >= ? AND ${at} < ?
        AND ${currentEvidenceCondition('symptom_entry')} ${ingestionFilter}
    ), calendar_events AS (
      SELECT at_key, 1 AS entry, NULL AS calendar_date, NULL AS calendar_to FROM occurrences
      UNION ALL SELECT from_key, 0, date, to_key FROM days
    ), calendar_sweep AS (
      SELECT *, max(calendar_date) OVER calendar_order AS date,
        max(calendar_to) OVER calendar_order AS day_to
      FROM calendar_events
      WINDOW calendar_order AS (
        ORDER BY at_key, entry ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      )
    )
    SELECT count(*) AS entries, count(DISTINCT date) AS recorded_days
    FROM calendar_sweep WHERE entry = 1 AND at_key < day_to
  )`,
    parameters,
  );
  const row = count.rows[0];
  if (
    !row ||
    typeof row.entries !== 'number' ||
    typeof row.recorded_days !== 'number'
  )
    throw new Error('Health context returned invalid symptom coverage.');
  const latestParameters: SqlValue[] = [
    localQueryTimestampKey(days[0]!.fromInclusive),
    localQueryTimestampKey(days.at(-1)!.toExclusive),
  ];
  if (dataAvailableThrough)
    latestParameters.push(localQueryTimestampKey(dataAvailableThrough));
  const latest = await executor.execute(
    `SELECT ${occurred} AS occurred,
      json_extract(r.payload_json, '$.description') AS description,
      json_extract(r.payload_json, '$.severity') AS severity
    FROM symptom_entries r WHERE ${at} >= ? AND ${at} < ?
      AND ${currentEvidenceCondition('symptom_entry')} ${ingestionFilter}
      ORDER BY ${at} DESC, r.id`,
    latestParameters,
  );
  return {
    entryCount: row.entries,
    recordedDays: row.recorded_days,
    latest: latest.rows.map(value => {
      if (
        typeof value.occurred !== 'string' ||
        typeof value.description !== 'string'
      )
        throw new Error('Health context returned an invalid symptom example.');
      return {
        effectiveAt: value.occurred,
        description: value.description,
        // SymptomEntry stores a reported 0–10 score; keep its number rather than discarding it as non-text.
        ...(typeof value.severity === 'number' &&
        Number.isInteger(value.severity) &&
        value.severity >= 0 &&
        value.severity <= 10
          ? { severity: value.severity }
          : {}),
      };
    }),
  };
}
