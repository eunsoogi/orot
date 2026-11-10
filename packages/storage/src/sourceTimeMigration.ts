import type { SqlExecutor } from './sql';

/** Preserve all existing integrity rules while allowing unknown clinical times in imported sources. */
export async function migrateSourceTimes(transaction: SqlExecutor): Promise<void> {
  const tables = ['source_records', 'evidence_spans'];
  const schemas = await Promise.all(
    tables.map((table) => transaction.execute(`PRAGMA table_info(${table})`)),
  );
  if (
    schemas.some((result) =>
      ['effective_at', 'recorded_at'].some(
        (name) =>
          !result.rows.some((row) => row.name === name && (row.notnull === 0 || row.notnull === 1)),
      ),
    )
  )
    throw new Error('Source timestamp schema is unavailable.');
  if (
    schemas.every((result) =>
      result.rows
        .filter((row) => row.name === 'effective_at' || row.name === 'recorded_at')
        .every((row) => Number(row.notnull) === 0),
    )
  )
    return;
  const schema = await transaction.execute(
    "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND (type = 'trigger' OR (type = 'index' AND tbl_name IN ('source_records', 'evidence_spans'))) ORDER BY type, name",
  );
  // Triggers on other tables also reference these tables; remove them only inside this transaction.
  for (const row of schema.rows) {
    if (row.type === 'trigger' && typeof row.name === 'string') {
      await transaction.execute('DROP TRIGGER "' + row.name.replace(/"/g, '""') + '"');
    }
  }
  for (const table of tables) {
    await transaction.execute(
      `CREATE TABLE ${table}_v14 (id TEXT PRIMARY KEY NOT NULL, effective_at TEXT, recorded_at TEXT, ingested_at TEXT NOT NULL, payload_json TEXT NOT NULL CHECK (json_valid(payload_json)))`,
    );
    await transaction.execute(
      `INSERT INTO ${table}_v14 SELECT id, effective_at, recorded_at, ingested_at, payload_json FROM ${table}`,
    );
    await transaction.execute(`DROP TABLE ${table}`);
    await transaction.execute(`ALTER TABLE ${table}_v14 RENAME TO ${table}`);
  }
  for (const row of schema.rows) {
    if (typeof row.sql !== 'string') throw new Error('Invalid database schema definition.');
    await transaction.execute(row.sql);
  }
}
