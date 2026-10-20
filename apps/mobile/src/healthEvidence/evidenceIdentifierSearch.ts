import { STORAGE_TABLES } from '@orot/storage';
import type { RecordKind, SqlDatabase, SqlResult } from '@orot/storage';

/**
 * Exact substring lookup without testing a long payload against every stored ID.
 * Large tables probe their primary-key index with text substrings of stored ID
 * byte lengths. Byte slices avoid repeatedly scanning a long Unicode prefix for
 * every position; casting each slice back to text retains exact ID index probes.
 * Spaces, punctuation, Unicode and overlapping IDs retain instr semantics.
 * Table names come only from the fixed storage registry.
 */
export async function findIdentifiersInTable(
  database: SqlDatabase,
  kind: RecordKind,
  text: string,
): Promise<SqlResult> {
  if (!Object.hasOwn(STORAGE_TABLES, kind))
    throw new Error('Invalid evidence kind.');
  const table = STORAGE_TABLES[kind].table;
  const count = await database.execute(
    `SELECT count(*) AS total FROM ${table}`,
  );
  const total = count.rows[0]?.total;
  if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0)
    throw new Error('The identifier catalog could not be read.');
  if (total === 0) return { rows: [] };
  if (total <= 1024) {
    return database.execute(
      `SELECT id FROM ${table} WHERE instr(?, id) > 0 LIMIT 1025`,
      [text],
    );
  }
  return database.execute(
    `SELECT DISTINCT id FROM (
      WITH RECURSIVE positions(position) AS (
        SELECT 1 UNION ALL SELECT position + 1 FROM positions WHERE position < length(CAST(? AS BLOB))
      ), lengths AS MATERIALIZED (
        SELECT DISTINCT length(CAST(id AS BLOB)) AS size FROM ${table}
        WHERE length(CAST(id AS BLOB)) > 0 AND length(CAST(id AS BLOB)) <= length(CAST(? AS BLOB))
      )
      SELECT r.id FROM lengths CROSS JOIN positions CROSS JOIN ${table} r
        ON r.id = CAST(substr(CAST(? AS BLOB), positions.position, lengths.size) AS TEXT)
      WHERE positions.position + lengths.size - 1 <= length(CAST(? AS BLOB))
    ) LIMIT 1025`,
    [text, text, text, text],
  );
}
