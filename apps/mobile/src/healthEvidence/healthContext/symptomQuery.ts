import {
  localQueryTimestampKey,
  localQueryTimestampKeyExpression,
} from '@orot/storage';
import type { SqlExecutor, SqlValue } from '@orot/storage';
import { currentEvidenceCondition } from '../evidenceCandidateScope';
import type { HealthContextDay, HealthContextReport } from './types';

/** Counts the full requested local period while keeping only six recent symptom descriptions as examples. */
export async function readHealthSymptomContext(
  executor: SqlExecutor,
  days: readonly HealthContextDay[],
): Promise<HealthContextReport['symptoms']> {
  const occurred =
    "coalesce(json_extract(r.payload_json, '$.startedAt'), r.effective_at)";
  const at = localQueryTimestampKeyExpression(occurred);
  const parameters: SqlValue[] = days.flatMap(day => [
    day.date,
    localQueryTimestampKey(day.fromInclusive),
    localQueryTimestampKey(day.toExclusive),
  ]);
  const count = await executor.execute(
    `SELECT * FROM (
    WITH days(date, from_key, to_key) AS (VALUES ${days.map(() => '(?, ?, ?)').join(', ')})
    SELECT count(*) AS entries, count(DISTINCT days.date) AS recorded_days
    FROM symptom_entries r JOIN days ON ${at} >= days.from_key AND ${at} < days.to_key
    WHERE ${currentEvidenceCondition('symptom_entry')}
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
  const latest = await executor.execute(
    `SELECT ${occurred} AS occurred,
      substr(json_extract(r.payload_json, '$.description'), 1, 1000) AS description,
      json_extract(r.payload_json, '$.severity') AS severity
    FROM symptom_entries r WHERE ${at} >= ? AND ${at} < ? AND ${currentEvidenceCondition('symptom_entry')} ORDER BY ${at} DESC, r.id LIMIT 6`,
    [
      localQueryTimestampKey(days[0]!.fromInclusive),
      localQueryTimestampKey(days.at(-1)!.toExclusive),
    ],
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
