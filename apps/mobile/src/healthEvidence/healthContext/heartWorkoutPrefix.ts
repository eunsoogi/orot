import type { SqlExecutor, SqlValue } from '@orot/storage';

const table = 'temp.orot_heart_workout_prefix';
export type ReleaseHeartWorkoutPrefix = () => Promise<unknown>;
export type AcquireHeartWorkoutPrefix = () => Promise<
  ReleaseHeartWorkoutPrefix | undefined
>;

/** The protected DB keeps TEMP tables in memory. Cleanup bypasses the
 * report's cancellation wrapper so an aborted proof cannot retain the rows.
 */
export function releaseHeartWorkoutPrefix(tx: SqlExecutor) {
  return () => tx.execute(`DROP TABLE IF EXISTS ${table}`);
}

/** Only the bundled SQLCipher mode that forces TEMP to memory regardless of
 * the connection pragma can use this workspace. Other adapters keep the
 * read-only sweep. Never mutate a shared connection's temp_store setting.
 */
export function nativeHeartWorkoutPrefix(
  executor: SqlExecutor,
  transaction: SqlExecutor,
): AcquireHeartWorkoutPrefix {
  let pinned: Promise<boolean> | undefined;
  let inUse = false;
  const release = releaseHeartWorkoutPrefix(transaction);
  return async () => {
    pinned ??= executor
      .execute('PRAGMA compile_options')
      .then(result =>
        result.rows.some(row => row.compile_options === 'TEMP_STORE=3'),
      );
    if (!(await pinned) || inUse) return undefined;
    inUse = true;
    return async () => {
      try {
        await release();
      } finally {
        inUse = false;
      }
    };
  };
}

/** Index the prefix maxima of workout ends, not the heart samples. Each
 * sample seeks the last admitted workout event instead of sorting all heart
 * rows together with the much smaller workout stream.
 */
export async function readHeartWithWorkoutPrefix(
  executor: SqlExecutor,
  release: ReleaseHeartWorkoutPrefix,
  input: {
    calendarSql: string;
    calendar: string;
    workoutsSql: string;
    workoutBindings: SqlValue[];
    heartSql: string;
    heartBindings: SqlValue[];
    to: string;
  },
) {
  try {
    await executor.execute(
      `CREATE TEMP TABLE ${table} (start_key TEXT PRIMARY KEY, prefix_end TEXT NOT NULL) WITHOUT ROWID`,
    );
    await executor.execute(
      `INSERT INTO ${table}
      WITH admitted AS (${input.workoutsSql})
      SELECT start_key, max(end_key) OVER (
        ORDER BY start_key ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
      FROM (SELECT start_key, max(end_key) AS end_key FROM admitted GROUP BY start_key)`,
      input.workoutBindings,
    );
    // Intervals end before a workout starting at the same instant. Points
    // at a workout start include that workout. Both use its half-open end.
    return await executor.execute(
      `SELECT * FROM (
      WITH days(date, from_key, to_key) AS MATERIALIZED (${input.calendarSql}),
      workouts AS MATERIALIZED (SELECT 1 FROM ${table} LIMIT 1),
      heart AS MATERIALIZED (${input.heartSql}),
      classified AS (
        SELECT h.date, h.unit, h.sensor, h.amount,
          CASE WHEN h.end_key IS NULL OR h.end_key < h.start_key OR h.end_key > ?
            OR NOT EXISTS (SELECT 1 FROM workouts) THEN 'unknown'
          WHEN coalesce(
            CASE WHEN h.end_key > h.start_key THEN (
              SELECT prefix_end FROM ${table} WHERE start_key < h.end_key ORDER BY start_key DESC LIMIT 1
            ) ELSE (
              SELECT prefix_end FROM ${table} WHERE start_key <= h.start_key ORDER BY start_key DESC LIMIT 1
            ) END, '') > h.start_key THEN 'workout_overlap'
          ELSE 'no_recorded_workout_overlap' END AS context
        FROM heart h
      )
      SELECT date, unit, sensor, context, count(*) AS samples,
        min(amount) AS minimum, max(amount) AS maximum
      FROM classified GROUP BY date, unit, sensor, context
    )`,
      [input.calendar, ...input.heartBindings, input.to],
    );
  } finally {
    await release();
  }
}
