import { STORAGE_TABLES } from './contracts';
import type { RecordKind } from './contracts';
import type { SqlExecutor } from './sql';
import {
  removedRecordReferencePredicate,
  SOURCE_DELETION_TOMBSTONES_TABLE,
  sourceDeletionDependencyPredicate,
} from './sourceDeletionReferences';

/** Persists source/dependent identity fences before cascading local records on deletion. */
export async function createSourceDeletionIntegrity(transaction: SqlExecutor): Promise<void> {
  await transaction.execute(
    `CREATE TABLE IF NOT EXISTS ${SOURCE_DELETION_TOMBSTONES_TABLE} (
      source_id TEXT PRIMARY KEY NOT NULL
    )`,
  );
  await transaction.execute(
    `CREATE TRIGGER IF NOT EXISTS source_records_reject_deleted_insert
     BEFORE INSERT ON source_records
     WHEN EXISTS (
       SELECT 1 FROM ${SOURCE_DELETION_TOMBSTONES_TABLE}
       WHERE source_id = NEW.id
     )
     BEGIN SELECT RAISE(ABORT, 'A deleted source cannot be reimported.'); END`,
  );
  await transaction.execute(
    `CREATE TRIGGER IF NOT EXISTS source_records_reject_deleted_update
     BEFORE UPDATE OF payload_json ON source_records
     WHEN EXISTS (
       SELECT 1 FROM ${SOURCE_DELETION_TOMBSTONES_TABLE}
       WHERE source_id = NEW.id
     )
     BEGIN SELECT RAISE(ABORT, 'A deleted source cannot be reimported.'); END`,
  );
  await transaction.execute(
    `CREATE TRIGGER IF NOT EXISTS source_records_tombstone_delete
     AFTER DELETE ON source_records
     BEGIN
       INSERT OR IGNORE INTO ${SOURCE_DELETION_TOMBSTONES_TABLE} (source_id) VALUES (OLD.id);
     END`,
  );

  // Memory may reference a transcript family or revision without naming its recording source.
  await transaction.execute(
    `CREATE TRIGGER IF NOT EXISTS source_records_tombstone_transcript_references
     BEFORE DELETE ON source_records
     BEGIN
       INSERT OR IGNORE INTO ${SOURCE_DELETION_TOMBSTONES_TABLE} (source_id)
       SELECT id FROM transcript_segments WHERE json_extract(payload_json, '$.recordingSourceId') = OLD.id;
       INSERT OR IGNORE INTO ${SOURCE_DELETION_TOMBSTONES_TABLE} (source_id)
       SELECT json_extract(payload_json, '$.transcriptId') FROM transcript_segments WHERE json_extract(payload_json, '$.recordingSourceId') = OLD.id;
     END`,
  );

  for (const [kind, definition] of Object.entries(STORAGE_TABLES) as [
    RecordKind,
    (typeof STORAGE_TABLES)[RecordKind],
  ][]) {
    if (kind === 'source_record') continue;
    const table = definition.table;
    const removedReference = removedRecordReferencePredicate(kind, 'NEW.payload_json', 'NEW.id');
    await transaction.execute(
      `CREATE TRIGGER IF NOT EXISTS ${table}_reject_removed_reference_insert
       BEFORE INSERT ON ${table} WHEN ${removedReference}
       BEGIN SELECT RAISE(ABORT, 'Deleted evidence cannot be reinserted.'); END`,
    );
    await transaction.execute(
      `CREATE TRIGGER IF NOT EXISTS ${table}_reject_removed_reference_update
       BEFORE UPDATE OF id, payload_json ON ${table} WHEN ${removedReference}
       BEGIN SELECT RAISE(ABORT, 'Deleted evidence cannot be reinserted.'); END`,
    );
  }

  for (const [kind, definition] of Object.entries(STORAGE_TABLES) as [
    RecordKind,
    (typeof STORAGE_TABLES)[RecordKind],
  ][]) {
    if (kind === 'source_record' || kind === 'evidence_span' || kind === 'transcript_segment')
      continue;
    const table = definition.table;
    const dependencyPredicate = sourceDeletionDependencyPredicate(kind, table, 'OLD.id');
    await transaction.execute(
      `CREATE TRIGGER IF NOT EXISTS source_records_delete_${table}_dependencies
       BEFORE DELETE ON source_records BEGIN
         INSERT OR IGNORE INTO ${SOURCE_DELETION_TOMBSTONES_TABLE} (source_id)
         SELECT id FROM ${table} WHERE ${dependencyPredicate};
         DELETE FROM ${table} WHERE ${dependencyPredicate};
       END`,
    );
  }

  // Version eight used this name for a cascade that removed spans without preserving their IDs.
  await transaction.execute('DROP TRIGGER IF EXISTS source_records_delete_evidence_spans');
  await transaction.execute(
    `CREATE TRIGGER source_records_delete_evidence_spans AFTER DELETE ON source_records BEGIN
       INSERT OR IGNORE INTO ${SOURCE_DELETION_TOMBSTONES_TABLE} (source_id)
       SELECT id FROM evidence_spans WHERE json_extract(payload_json, '$.sourceRecordId') = OLD.id;
       DELETE FROM evidence_spans WHERE json_extract(payload_json, '$.sourceRecordId') = OLD.id;
     END`,
  );
}
