import type { SqlExecutor } from './sql';

/** Install the metadata and deletion guard together, including on restored databases. */
export async function ensureSymptomMetadata(executor: SqlExecutor): Promise<void> {
  await executor.execute(
    'CREATE TABLE IF NOT EXISTS symptom_local_updates (symptom_id TEXT PRIMARY KEY NOT NULL, updated_at TEXT NOT NULL)',
  );
  await executor.execute(
    'CREATE TRIGGER IF NOT EXISTS symptom_delete_local_update AFTER DELETE ON symptom_entries BEGIN DELETE FROM symptom_local_updates WHERE symptom_id = OLD.id; END',
  );
}

export async function putSymptomUpdate(
  executor: SqlExecutor,
  id: string,
  time: string,
): Promise<void> {
  await ensureSymptomMetadata(executor);
  await executor.execute(
    'INSERT INTO symptom_local_updates (symptom_id, updated_at) VALUES (?, ?) ON CONFLICT(symptom_id) DO UPDATE SET updated_at = excluded.updated_at',
    [id, time],
  );
}
