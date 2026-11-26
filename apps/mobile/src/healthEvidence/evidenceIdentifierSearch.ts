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
  // One SQLite statement pins branch selection to the same snapshot as the
  // actual lookup and avoids a second bridge hop for each populated table.
  // Scalar gates keep the unused scan/search arm empty.
  return database.execute(
    `SELECT id FROM (
      WITH RECURSIVE cardinality(total) AS MATERIALIZED (
        SELECT count(*) FROM ${table}
      ), positions(position) AS (
        SELECT 1 FROM cardinality WHERE total > 1024
        UNION ALL SELECT position + 1 FROM positions WHERE position < length(CAST(? AS BLOB))
      ), lengths AS MATERIALIZED (
        SELECT DISTINCT length(CAST(id AS BLOB)) AS size
        FROM cardinality CROSS JOIN ${table}
        WHERE total > 1024 AND length(CAST(id AS BLOB)) > 0
          AND length(CAST(id AS BLOB)) <= length(CAST(? AS BLOB))
      )
      SELECT id FROM cardinality CROSS JOIN ${table}
      WHERE total BETWEEN 1 AND 1024 AND instr(?, id) > 0
      UNION ALL
      SELECT DISTINCT r.id FROM lengths CROSS JOIN positions CROSS JOIN ${table} r
        ON r.id = CAST(substr(CAST(? AS BLOB), positions.position, lengths.size) AS TEXT)
      WHERE positions.position + lengths.size - 1 <= length(CAST(? AS BLOB))
    ) AS exact_identifier_candidates`,
    [text, text, text, text, text],
  );
}
