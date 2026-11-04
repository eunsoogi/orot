import type { SqlExecutor } from './sql';

/** Kind-scoped tombstones survive interruption and block delayed writes of deleted symptoms. */
export async function ensureSymptomDeletionFence(sql: SqlExecutor): Promise<void> {
  await sql.execute(
    'CREATE TABLE IF NOT EXISTS legacy_symptom_deleted (id TEXT PRIMARY KEY NOT NULL)',
  );
  await sql.execute(
    "CREATE TRIGGER IF NOT EXISTS legacy_symptom_reject_deleted_insert BEFORE INSERT ON symptom_entries WHEN EXISTS (SELECT 1 FROM legacy_symptom_deleted WHERE id = NEW.id) BEGIN SELECT RAISE(ABORT, 'A deleted symptom cannot be restored.'); END",
  );
  await sql.execute(
    "CREATE TRIGGER IF NOT EXISTS legacy_symptom_reject_deleted_update BEFORE UPDATE OF id ON symptom_entries WHEN EXISTS (SELECT 1 FROM legacy_symptom_deleted WHERE id = NEW.id) BEGIN SELECT RAISE(ABORT, 'A deleted symptom cannot be restored.'); END",
  );
}
