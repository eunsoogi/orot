import type { SqlDatabase, SqlExecutor } from '@orot/storage';

type Advance = (
  previous: string | null,
  next: string,
  at: string,
  current: () => boolean,
) => Promise<boolean>;
const connections = new WeakMap<SqlDatabase, Advance>();
const key = 'healthkit:steps:steps';
const table =
  'CREATE TABLE healthkit_sync_checkpoints (checkpoint_key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL)';

export function registerStepAnchorConnection(
  database: SqlDatabase,
  advance: Advance,
) {
  connections.set(database, advance);
}

export function aliasStepAnchorConnection(
  database: SqlDatabase,
  facade: SqlDatabase,
) {
  const advance = connections.get(database);
  if (advance) connections.set(facade, advance);
}

export function stepAnchorConnection(
  database: SqlDatabase,
): Advance | undefined {
  return connections.get(database);
}

// Exact positive proof on the same transaction. A restored/altered schema may
// not lend non-mutating-child authority to an otherwise fixed UPSERT.
export async function proveStepAnchorTable(executor: SqlExecutor) {
  const result = await executor.execute(
    `SELECT sql FROM main.sqlite_schema
       WHERE type = 'table' AND name = 'healthkit_sync_checkpoints'
       AND NOT EXISTS (SELECT 1 FROM main.sqlite_schema WHERE type = 'trigger' AND lower(tbl_name) = 'healthkit_sync_checkpoints')
       AND NOT EXISTS (SELECT 1 FROM sqlite_temp_schema WHERE type = 'trigger' AND lower(tbl_name) = 'healthkit_sync_checkpoints')
       AND NOT EXISTS (
         SELECT 1 FROM main.sqlite_schema AS t, pragma_foreign_key_list(t.name, 'main') AS fk
         WHERE t.type = 'table' AND lower(fk."table") = 'healthkit_sync_checkpoints'
       )`,
  );
  return result.rows.length === 1 && result.rows[0]?.sql === table;
}

export async function advanceExactStepAnchor(
  executor: SqlExecutor,
  previous: string | null,
  next: string,
  at: string,
) {
  const result = await executor.execute(
    `INSERT INTO main.healthkit_sync_checkpoints (checkpoint_key, value, updated_at)
     SELECT ?, ?, ?
     WHERE (? IS NULL OR EXISTS (
       SELECT 1 FROM main.healthkit_sync_checkpoints WHERE checkpoint_key = ? AND value = ?
     ))
     ON CONFLICT(checkpoint_key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
     WHERE healthkit_sync_checkpoints.value = ?
     RETURNING 1 AS advanced`,
    [key, next, at, previous, key, previous, previous],
  );
  if (result.rows.length === 0) return false; // CAS refusal; execution completed.
  if (result.rows.length !== 1 || result.rows[0]?.advanced !== 1)
    throw new Error('Step cursor receipt invalid.');
  return true;
}
