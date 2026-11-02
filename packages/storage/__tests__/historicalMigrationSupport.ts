import type { SqlDatabase, SqlTransaction } from '../src';
import { openSqliteTestDatabase } from './sqliteTestDatabase';

// Schema v2: 5176df825 created these tables; d410e9610 added integrity.
// Historical DDL must remain independent of the current migration code.
const tables = [
  'source_records',
  'evidence_spans',
  'encounters',
  'health_observations',
  'symptom_entries',
  'medication_assertions',
  'dose_events',
  'appointments',
  'visit_questions',
  'visit_briefs',
];

export async function createVersionTwo(database: SqlDatabase): Promise<void> {
  for (const table of tables) {
    await database.execute(
      `CREATE TABLE ${table} (id TEXT PRIMARY KEY NOT NULL, effective_at TEXT NOT NULL, recorded_at TEXT NOT NULL, ingested_at TEXT NOT NULL, payload_json TEXT NOT NULL CHECK (json_valid(payload_json)))`,
    );
    await database.execute(`CREATE INDEX ${table}_effective_at_idx ON ${table} (effective_at)`);
  }
  for (const query of [
    "CREATE UNIQUE INDEX source_records_content_hash_idx ON source_records (json_extract(payload_json, '$.contentHash')) WHERE json_type(payload_json, '$.contentHash') = 'text'",
    "CREATE INDEX evidence_spans_source_record_idx ON evidence_spans (json_extract(payload_json, '$.sourceRecordId'))",
    "CREATE TRIGGER evidence_spans_require_source_insert BEFORE INSERT ON evidence_spans WHEN NOT EXISTS (SELECT 1 FROM source_records WHERE id = json_extract(NEW.payload_json, '$.sourceRecordId')) BEGIN SELECT RAISE(ABORT, 'Evidence span source record does not exist.'); END",
    "CREATE TRIGGER evidence_spans_require_source_update BEFORE UPDATE OF payload_json ON evidence_spans WHEN NOT EXISTS (SELECT 1 FROM source_records WHERE id = json_extract(NEW.payload_json, '$.sourceRecordId')) BEGIN SELECT RAISE(ABORT, 'Evidence span source record does not exist.'); END",
    "CREATE TRIGGER source_records_delete_evidence_spans AFTER DELETE ON source_records BEGIN DELETE FROM evidence_spans WHERE json_extract(payload_json, '$.sourceRecordId') = OLD.id; END",
    'PRAGMA user_version = 2',
  ])
    await database.execute(query);
}

export function openMigrationDatabase(path: string, failOn?: string) {
  const connection = openSqliteTestDatabase(path);
  const database: SqlDatabase = {
    execute: connection.database.execute,
    transaction(operation) {
      return connection.database.transaction((transaction) => {
        const injecting: SqlTransaction = {
          ...transaction,
          async execute(query, parameters) {
            if (failOn && query.includes(failOn)) throw new Error('injected migration failure');
            return transaction.execute(query, parameters);
          },
        };
        return operation(injecting);
      });
    },
  };
  return { database, close: connection.close };
}
