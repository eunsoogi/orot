import type { SqlExecutor } from './sql';

/** Reject malformed version metadata before deciding which migrations may run. */
export async function readUserVersion(database: SqlExecutor): Promise<number> {
  const result = await database.execute('PRAGMA user_version');
  const version = Number(result.rows[0]?.user_version ?? 0);
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new Error('The database schema version is invalid.');
  }
  return version;
}
