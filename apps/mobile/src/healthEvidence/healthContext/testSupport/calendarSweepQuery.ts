import { localQueryTimestampKeyExpression } from '@orot/storage';

/** Retain the previous calendar-sweep admission algorithm as a differential oracle.
 * Ranking and aggregation stay shared so the test isolates day assignment. */
export function calendarSweepQuery(query: string): string {
  const at = localQueryTimestampKeyExpression('r.effective_at');
  const legacy = query
    .replace('SELECT d.date, r.id,', 'SELECT r.id,')
    .replace(
      'FROM days d CROSS JOIN health_observations r',
      'FROM health_observations r',
    )
    .replace(
      `WHERE ${at} >= d.from_key AND ${at} < d.to_key\n          AND`,
      'WHERE',
    )
    .replace(
      /\), dated AS \([\s\S]*?\), ranked AS \(/,
      `), calendar_events AS (
        SELECT o.*, NULL AS calendar_date, NULL AS calendar_to, 1 AS sample FROM observations o
        UNION ALL SELECT NULL, NULL, from_key, NULL, NULL, NULL, NULL, date, to_key, 0 FROM days
      ), calendar_sweep AS (
        SELECT *, max(calendar_date) OVER calendar_order AS date,
          max(calendar_to) OVER calendar_order AS day_to FROM calendar_events
        WINDOW calendar_order AS (ORDER BY at_key, sample ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
      ), dated AS MATERIALIZED (
        SELECT id, at, at_key, concept, unit, amount, sensor, date
        FROM calendar_sweep WHERE sample = 1 AND at_key < day_to
      ), ranked AS (`,
    );
  if (legacy === query || legacy.includes('FROM days d CROSS JOIN'))
    throw new Error(
      'Calendar differential oracle no longer matches the query.',
    );
  return legacy;
}
