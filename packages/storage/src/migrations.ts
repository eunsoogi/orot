import { isRecordKind, parseRecord, STORAGE_TABLES } from './contracts';
import type { RecordKind, RecordMap } from './contracts';
import type { SqlDatabase, SqlExecutor } from './sql';

export const CURRENT_SCHEMA_VERSION = 2;

async function readUserVersion(database: SqlExecutor): Promise<number> {
  const result = await database.execute('PRAGMA user_version');
  const version = Number(result.rows[0]?.user_version ?? 0);
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new Error('The database schema version is invalid.');
  }
  return version;
}

async function createInitialTables(transaction: SqlExecutor): Promise<void> {
  for (const definition of Object.values(STORAGE_TABLES)) {
    await transaction.execute(
      'CREATE TABLE IF NOT EXISTS ' +
        definition.table +
        ' (' +
        'id TEXT PRIMARY KEY NOT NULL, effective_at TEXT NOT NULL, ' +
        'recorded_at TEXT NOT NULL, ingested_at TEXT NOT NULL, ' +
        'payload_json TEXT NOT NULL CHECK (json_valid(payload_json)))',
    );
    await transaction.execute(
      'CREATE INDEX IF NOT EXISTS ' +
        definition.table +
        '_effective_at_idx ON ' +
        definition.table +
        ' (effective_at)',
    );
  }
}

async function createSourceEvidenceIntegrity(transaction: SqlExecutor): Promise<void> {
  await transaction.execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS source_records_content_hash_idx ON source_records (json_extract(payload_json, '$.contentHash')) WHERE json_type(payload_json, '$.contentHash') = 'text'",
  );
  await transaction.execute(
    "CREATE INDEX IF NOT EXISTS evidence_spans_source_record_idx ON evidence_spans (json_extract(payload_json, '$.sourceRecordId'))",
  );
  await transaction.execute(
    "CREATE TRIGGER IF NOT EXISTS evidence_spans_require_source_insert BEFORE INSERT ON evidence_spans WHEN NOT EXISTS (SELECT 1 FROM source_records WHERE id = json_extract(NEW.payload_json, '$.sourceRecordId')) BEGIN SELECT RAISE(ABORT, 'Evidence span source record does not exist.'); END",
  );
  await transaction.execute(
    "CREATE TRIGGER IF NOT EXISTS evidence_spans_require_source_update BEFORE UPDATE OF payload_json ON evidence_spans WHEN NOT EXISTS (SELECT 1 FROM source_records WHERE id = json_extract(NEW.payload_json, '$.sourceRecordId')) BEGIN SELECT RAISE(ABORT, 'Evidence span source record does not exist.'); END",
  );
  await transaction.execute(
    "CREATE TRIGGER IF NOT EXISTS source_records_delete_evidence_spans AFTER DELETE ON source_records BEGIN DELETE FROM evidence_spans WHERE json_extract(payload_json, '$.sourceRecordId') = OLD.id; END",
  );
}

async function hasLegacyTable(transaction: SqlExecutor): Promise<boolean> {
  const result = await transaction.execute(
    "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'records' LIMIT 1",
  );
  return result.rows.length > 0;
}

async function insertLegacyRecord<K extends RecordKind>(
  transaction: SqlExecutor,
  kind: K,
  record: RecordMap[K],
): Promise<void> {
  const parsed = parseRecord(kind, record);
  await transaction.execute(
    'INSERT INTO ' +
      STORAGE_TABLES[kind].table +
      ' (id, effective_at, recorded_at, ingested_at, payload_json) VALUES (?, ?, ?, ?, ?)',
    [parsed.id, parsed.effectiveAt, parsed.recordedAt, parsed.ingestedAt, JSON.stringify(parsed)],
  );
}

async function migrateLegacyRows(transaction: SqlExecutor): Promise<void> {
  const legacy = await transaction.execute('SELECT record_type, payload_json FROM records');
  for (const row of legacy.rows) {
    if (typeof row.record_type !== 'string' || !isRecordKind(row.record_type)) {
      throw new Error('The earlier database schema contains an unsupported record type.');
    }
    if (typeof row.payload_json !== 'string') {
      throw new Error('The earlier database schema contains an invalid record.');
    }
    let payload: unknown;
    try {
      payload = JSON.parse(row.payload_json);
    } catch {
      throw new Error('The earlier database schema contains an invalid record.');
    }
    await insertLegacyRecord(transaction, row.record_type, parseRecord(row.record_type, payload));
  }
}

export async function runMigrations(database: SqlDatabase): Promise<void> {
  const currentVersion = await readUserVersion(database);
  if (currentVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error('The database schema is newer than this application supports.');
  }
  if (currentVersion === CURRENT_SCHEMA_VERSION) return;

  await database.transaction(async (transaction) => {
    if (currentVersion === 0) {
      const hasLegacy = await hasLegacyTable(transaction);
      await createInitialTables(transaction);
      if (hasLegacy) {
        await migrateLegacyRows(transaction);
        await transaction.execute('DROP TABLE records');
      }
    }
    await createSourceEvidenceIntegrity(transaction);
    await transaction.execute('PRAGMA user_version = 2');
  });
}
