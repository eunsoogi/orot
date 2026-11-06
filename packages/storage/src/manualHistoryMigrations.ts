import type { SqlExecutor } from './sql';

/** Adds the existing manual-history schema without changing prior record payloads. */
export async function createManualHistoryTable(transaction: SqlExecutor): Promise<void> {
  await transaction.execute(
    'CREATE TABLE IF NOT EXISTS manual_history_entries (' +
      'id TEXT PRIMARY KEY NOT NULL, ' +
      "entry_kind TEXT NOT NULL CHECK (entry_kind IN ('diagnosis_history', 'procedure', 'medication_context', 'note')), " +
      'effective_date TEXT, date_known INTEGER NOT NULL CHECK (date_known IN (0, 1)), ' +
      'recorded_at TEXT NOT NULL, ingested_at TEXT NOT NULL, supersedes_id TEXT, ' +
      'payload_json TEXT NOT NULL CHECK (json_valid(payload_json)), ' +
      'CHECK ((date_known = 1 AND effective_date IS NOT NULL) OR ' +
      '(date_known = 0 AND effective_date IS NULL)))',
  );
  await transaction.execute(
    'CREATE INDEX IF NOT EXISTS manual_history_kind_date_idx ON ' +
      'manual_history_entries (entry_kind, date_known, effective_date)',
  );
  await transaction.execute(
    'CREATE INDEX IF NOT EXISTS manual_history_supersedes_idx ON ' +
      'manual_history_entries (supersedes_id)',
  );
  await transaction.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS manual_history_one_successor_idx ON ' +
      'manual_history_entries (supersedes_id) WHERE supersedes_id IS NOT NULL',
  );
}
