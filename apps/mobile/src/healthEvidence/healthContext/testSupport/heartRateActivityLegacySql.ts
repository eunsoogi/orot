import { localQueryTimestampKeyExpression } from '@orot/storage';

/** Reconstruct the prior calendar sweep from the indexed query for exact differential checks. */
export function previousHeartCalendarSweep(query: string): string {
  const at = localQueryTimestampKeyExpression('r.effective_at');
  const previous = query
    .replace('AS MATERIALIZED (SELECT json_extract', 'AS (SELECT json_extract')
    .replace('heart AS NOT MATERIALIZED (', 'undated_heart AS MATERIALIZED (')
    // The earlier correlated variant attaches its date after the timeline.
    .replace(
      'SELECT start_key, end_key, unit, amount, sensor, date, event_order, max(workout_end)',
      'SELECT e.*, max(workout_end)',
    )
    .replace(', d.date AS date', '')
    .replace(
      'FROM days d CROSS JOIN health_observations r',
      'FROM health_observations r',
    )
    .replace(`AND ${at} >= d.from_key AND ${at} < d.to_key `, '')
    .replace(
      '    ), events AS (',
      `    ), calendar_events AS (
      SELECT h.*, NULL AS calendar_date, NULL AS calendar_to, 1 AS boundary_order FROM undated_heart h
      UNION ALL
      SELECT from_key, NULL, NULL, NULL, NULL, date, to_key, 0 FROM days
    ), calendar_timeline AS (
      SELECT e.*, max(calendar_date) OVER calendar_order AS date,
        max(calendar_to) OVER calendar_order AS to_key
      FROM calendar_events e
      WINDOW calendar_order AS (
        ORDER BY start_key, boundary_order ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      )
    ), heart AS MATERIALIZED (
      SELECT start_key, end_key, unit, amount, sensor, date
      FROM calendar_timeline WHERE boundary_order = 1 AND start_key < to_key
    ), events AS (`,
    );
  if (
    previous === query ||
    !previous.includes('calendar_timeline') ||
    previous.includes('FROM days d CROSS JOIN')
  )
    throw new Error(
      'The heart calendar differential oracle did not reconstruct the old query.',
    );
  return previous;
}
