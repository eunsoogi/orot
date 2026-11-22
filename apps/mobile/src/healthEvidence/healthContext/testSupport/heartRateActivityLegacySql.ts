import { localQueryTimestampKeyExpression } from '@orot/storage';

/** Recover stock timeline SQL before its exact same-statement no-workout bypass. */
export function previousHeartWorkoutTimeline(query: string): string {
  const prior = query
    .replace(
      'NULL AS workout_end FROM heart h WHERE EXISTS (SELECT 1 FROM workouts)',
      'NULL AS workout_end FROM heart h',
    )
    .replace(
      "SELECT h.date, h.unit, h.sensor, h.amount,\n        CASE WHEN h.end_key IS NULL OR h.end_key < h.start_key OR h.end_key > ? THEN 'unknown'",
      "SELECT h.*,\n        CASE WHEN h.end_key IS NULL OR h.end_key < h.start_key OR h.end_key > ?\n          OR NOT EXISTS (SELECT 1 FROM workouts) THEN 'unknown'",
    )
    .replace(
      "\n      UNION ALL\n      SELECT h.date, h.unit, h.sensor, h.amount, 'unknown' FROM heart h\n      WHERE NOT EXISTS (SELECT 1 FROM workouts)",
      '',
    );
  if (
    prior === query ||
    !prior.includes('SELECT h.*,') ||
    prior.includes('FROM heart h WHERE EXISTS') ||
    prior.includes("'unknown' FROM heart h")
  ) {
    throw new Error(
      'The heart timeline differential oracle did not recover stock SQL.',
    );
  }
  return prior;
}

/** Reconstruct the prior calendar sweep from the indexed query for exact differential checks. */
export function previousHeartCalendarSweep(query: string): string {
  const at = localQueryTimestampKeyExpression('r.effective_at');
  const previous = previousHeartWorkoutTimeline(query)
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
