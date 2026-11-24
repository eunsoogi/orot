import type { SqlExecutor } from './sql';

/** Adds a writer-attested clock and indexes the rows already present at upgrade. */
export async function addAgentMemoryClockWitness(transaction: SqlExecutor): Promise<void> {
  await transaction.execute(
    'CREATE TABLE IF NOT EXISTS agent_memory_records (id TEXT PRIMARY KEY NOT NULL, record_json TEXT NOT NULL)',
  );
  await transaction.execute(
    'ALTER TABLE agent_memory_records ADD COLUMN recent_metadata_version INTEGER',
  );
  await transaction.execute(`ALTER TABLE agent_memory_records ADD COLUMN recent_created_at_ms INTEGER
    CHECK ((recent_metadata_version IS NULL AND recent_created_at_ms IS NULL) OR
      (recent_metadata_version IS NOT NULL AND recent_metadata_version > 0 AND
       recent_created_at_ms IS NOT NULL AND typeof(recent_created_at_ms) = 'integer'))`);
  // SQLite supplies the default for pre-existing rows without rewriting their bodies.
  // The triggers below remove it from all writes after this migration, including fresh inserts.
  await transaction.execute(`ALTER TABLE agent_memory_records ADD COLUMN recent_legacy_pending INTEGER
    NOT NULL DEFAULT 1 CHECK (recent_legacy_pending IN (0, 1))`);
  await transaction.execute(`CREATE INDEX agent_memory_legacy_pending_idx ON agent_memory_records
    (id COLLATE BINARY) WHERE recent_legacy_pending = 1`);
  await transaction.execute(`CREATE INDEX agent_memory_recent_metadata_idx ON agent_memory_records
    (recent_metadata_version, recent_created_at_ms DESC, id COLLATE BINARY DESC)
    WHERE recent_metadata_version IS NOT NULL`);
  // Use this same guarded expression in the bounded supersession lookup.
  const supersedesId =
    "CASE WHEN json_valid(payload_json) THEN json_extract(payload_json,'$.supersedesId') END";
  await transaction.execute(`CREATE INDEX transcript_segments_recent_memory_superseded_idx
    ON transcript_segments(${supersedesId}) WHERE ${supersedesId} IS NOT NULL`);
  // Bare SQL inserts, restores, and body replacements cannot retain a prior witness.
  // The canonical writer issues its separate attestation in the same transaction.
  for (const [trigger, event] of [
    ['agent_memory_recent_clear_on_insert', 'AFTER INSERT'],
    ['agent_memory_recent_clear_on_rewrite', 'AFTER UPDATE OF id, record_json'],
  ] as const) {
    await transaction.execute(`CREATE TRIGGER ${trigger} ${event} ON agent_memory_records
      WHEN NEW.recent_metadata_version IS NOT NULL OR NEW.recent_legacy_pending = 1 BEGIN
        UPDATE agent_memory_records
        SET recent_metadata_version=NULL, recent_created_at_ms=NULL, recent_legacy_pending=0
        WHERE id=NEW.id;
      END`);
  }
}
