import { STORAGE_TABLES } from './contracts';
import type { RecordKind } from './contracts';
import type { SqlDatabase, SqlExecutor } from './sql';
import { physicalHealthDeletionCandidates } from './sourceSnapshotHealthCandidates';
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

  await replaceSourceDeletionCascades(transaction);

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

function sourceDeletionCascadeDefinitions() {
  const definitions: { name: string; sql: string }[] = [];
  for (const [kind, definition] of Object.entries(STORAGE_TABLES) as [
    RecordKind,
    (typeof STORAGE_TABLES)[RecordKind],
  ][]) {
    if (kind === 'source_record' || kind === 'evidence_span' || kind === 'transcript_segment')
      continue;
    const table = definition.table;
    const trigger = `source_records_delete_${table}_dependencies`;
    const predicate = sourceDeletionDependencyPredicate(kind, table, 'OLD.id', true);
    const candidates =
      kind === 'health_observation'
        ? physicalHealthDeletionCandidates(predicate)
        : `SELECT id FROM ${table} WHERE ${predicate}`;
    // Bind both alias domains once to the physical OLD recording, not once per candidate.
    const dependencyPredicate = `${table}.id IN (
      WITH ${kind === 'health_observation' ? 'deletion_target(id) AS (SELECT OLD.id), ' : ''}target_transcripts AS MATERIALIZED (
        SELECT id, json_extract(payload_json, '$.transcriptId') AS family
        FROM transcript_segments
        WHERE json_extract(payload_json, '$.recordingSourceId') = OLD.id
      )
      ${candidates}
    )`;
    const fenceOfficial =
      kind === 'visit_question'
        ? `
         INSERT OR IGNORE INTO ${SOURCE_DELETION_TOMBSTONES_TABLE} (source_id)
         SELECT official.id FROM visit_question_records AS official
         JOIN visit_questions ON visit_questions.id = json_extract(official.payload_json, '$.questionId')
         WHERE ${dependencyPredicate};`
        : '';
    definitions.push({
      name: trigger,
      sql: `CREATE TRIGGER ${trigger}
       BEFORE DELETE ON source_records BEGIN
         ${fenceOfficial}
         INSERT OR IGNORE INTO ${SOURCE_DELETION_TOMBSTONES_TABLE} (source_id)
         SELECT id FROM ${table} WHERE ${dependencyPredicate};
         DELETE FROM ${table} WHERE ${dependencyPredicate};
       END`,
    });
  }
  return definitions;
}

export async function replaceSourceDeletionCascades(
  transaction: SqlExecutor,
  definitions = sourceDeletionCascadeDefinitions(),
) {
  for (const { name, sql } of definitions) {
    await transaction.execute(`DROP TRIGGER IF EXISTS ${name}`);
    await transaction.execute(sql);
  }
}

/** These replacement triggers use the same v20 table and row contract. Avoid a
 * write on ordinary opens; repair only stale owned definitions before use. */
export async function ensureSourceDeletionCascades(database: SqlDatabase): Promise<void> {
  const definitions = sourceDeletionCascadeDefinitions();
  const isCurrent = async (executor: SqlExecutor) => {
    const { rows } = await executor.execute(
      "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'source_records' AND name GLOB 'source_records_delete_*_dependencies'",
    );
    const installed = new Map(rows.map((row) => [row.name, row.sql]));
    return definitions.every(({ name, sql }) => installed.get(name) === sql);
  };
  if (await isCurrent(database)) return;
  await database.transaction(async (tx) => {
    if (!(await isCurrent(tx))) await replaceSourceDeletionCascades(tx, definitions);
  });
}
