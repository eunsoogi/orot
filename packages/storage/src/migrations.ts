import { isRecordKind, parseRecord, STORAGE_TABLES } from './contracts';
import type { RecordKind, RecordMap } from './contracts';
import type { SqlDatabase, SqlExecutor } from './sql';
import { createTranscriptEvidenceIntegrity } from './transcriptEvidenceMigrations';
import { createSourceDeletionIntegrity } from './sourceDeletionMigrations';
import { localQueryTimestampKeyExpression } from './localQueryTimestamp';

export const CURRENT_SCHEMA_VERSION = 9;

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
    const nullableSourceTimes =
      'nullableSourceTimes' in definition && definition.nullableSourceTimes;
    const nullableRecordedAt =
      nullableSourceTimes || ('nullableRecordedAt' in definition && definition.nullableRecordedAt);
    await transaction.execute(
      'CREATE TABLE IF NOT EXISTS ' +
        definition.table +
        ' (' +
        'id TEXT PRIMARY KEY NOT NULL, effective_at TEXT' +
        (nullableSourceTimes ? ', recorded_at TEXT' : ' NOT NULL, recorded_at TEXT') +
        (nullableRecordedAt ? '' : ' NOT NULL') +
        ', ingested_at TEXT NOT NULL, ' +
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

async function makeRecordedAtNullable(
  transaction: SqlExecutor,
  tableName: 'health_observations' | 'dose_events',
): Promise<void> {
  const table = await transaction.execute('PRAGMA table_info(' + tableName + ')');
  const recordedAt = table.rows.find((column) => column.name === 'recorded_at');
  if (!recordedAt || Number(recordedAt.notnull) === 0) return;

  // Preserve existing rows and indexed lookups while allowing the source time to remain unknown.
  const replacement = tableName + '_v5';
  await transaction.execute('DROP INDEX IF EXISTS ' + tableName + '_effective_at_idx');
  await transaction.execute(
    'CREATE TABLE ' +
      replacement +
      ' (' +
      'id TEXT PRIMARY KEY NOT NULL, effective_at TEXT NOT NULL, recorded_at TEXT, ' +
      'ingested_at TEXT NOT NULL, payload_json TEXT NOT NULL CHECK (json_valid(payload_json)))',
  );
  await transaction.execute(
    'INSERT INTO ' +
      replacement +
      ' (id, effective_at, recorded_at, ingested_at, payload_json) ' +
      'SELECT id, effective_at, recorded_at, ingested_at, payload_json FROM ' +
      tableName,
  );
  await transaction.execute('DROP TABLE ' + tableName);
  await transaction.execute('ALTER TABLE ' + replacement + ' RENAME TO ' + tableName);
  await transaction.execute(
    'CREATE INDEX ' + tableName + '_effective_at_idx ON ' + tableName + ' (effective_at)',
  );
}

async function createSyncCheckpoints(transaction: SqlExecutor): Promise<void> {
  await transaction.execute(
    'CREATE TABLE IF NOT EXISTS healthkit_sync_checkpoints (' +
      'checkpoint_key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL)',
  );
}

/** Indexes the exact JSON fields and instant ordering used by bounded local lookups. */
async function createLocalQueryIndexes(transaction: SqlExecutor): Promise<void> {
  // Replace version-seven Julian-day indexes so bounded reads sort source instants exactly.
  for (const index of [
    'health_observations_local_query_idx',
    'medication_definitions_local_query_idx',
    'dose_events_local_query_idx',
    'appointments_local_query_idx',
    'transcript_segments_local_query_idx',
  ]) {
    await transaction.execute('DROP INDEX IF EXISTS ' + index);
  }
  await transaction.execute(
    "CREATE INDEX IF NOT EXISTS health_observations_local_query_idx ON health_observations (json_extract(payload_json, '$.provenance.origin'), json_extract(payload_json, '$.provenance.source.system'), json_extract(payload_json, '$.concept'), " +
      localQueryTimestampKeyExpression('effective_at') +
      ', id)',
  );
  await transaction.execute(
    "CREATE INDEX IF NOT EXISTS medication_definitions_local_query_idx ON medication_definitions (json_extract(payload_json, '$.provenance.origin'), json_extract(payload_json, '$.provenance.source.system'), " +
      localQueryTimestampKeyExpression('ingested_at') +
      ', id)',
  );
  await transaction.execute(
    "CREATE INDEX IF NOT EXISTS dose_events_local_query_idx ON dose_events (json_extract(payload_json, '$.eventKind'), json_extract(payload_json, '$.provenance.origin'), json_extract(payload_json, '$.provenance.source.system'), " +
      localQueryTimestampKeyExpression('effective_at') +
      ', id)',
  );
  await transaction.execute(
    "CREATE INDEX IF NOT EXISTS appointments_local_query_idx ON appointments (json_extract(payload_json, '$.status'), json_extract(payload_json, '$.provenance.origin'), " +
      localQueryTimestampKeyExpression('effective_at') +
      ', id)',
  );
  await transaction.execute(
    "CREATE INDEX IF NOT EXISTS transcript_segments_local_query_idx ON transcript_segments (json_extract(payload_json, '$.recordingSourceId'), " +
      localQueryTimestampKeyExpression('effective_at') +
      ", json_extract(payload_json, '$.transcriptId'), json_extract(payload_json, '$.segmentOrdinal'), json_extract(payload_json, '$.revision'))",
  );
  await transaction.execute(
    'CREATE INDEX IF NOT EXISTS transcript_artifact_staleness_transcript_idx ON transcript_artifact_staleness (transcript_id, artifact_kind, artifact_id)',
  );
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
    [
      parsed.id,
      parsed.effectiveAt ?? null,
      parsed.recordedAt ?? null,
      parsed.ingestedAt,
      JSON.stringify(parsed),
    ],
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
    } else {
      // Add newly declared record tables, then preserve older rows while changing their schema.
      await createInitialTables(transaction);
    }
    await makeRecordedAtNullable(transaction, 'health_observations');
    await makeRecordedAtNullable(transaction, 'dose_events');
    await createSourceEvidenceIntegrity(transaction);
    await createSourceDeletionIntegrity(transaction);
    await createTranscriptEvidenceIntegrity(transaction);
    await createSyncCheckpoints(transaction);
    await createLocalQueryIndexes(transaction);
    await transaction.execute('PRAGMA user_version = 9');
  });
}
