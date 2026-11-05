import type { SqlExecutor } from './sql';

/** Current rows and immutable revisions commit together; source cascades also remove prior answer text. */
export async function createVisitQuestionRecordTables(sql: SqlExecutor): Promise<void> {
  // Keep the counter after deletion so reusing an ID cannot revive an old snapshot.
  await sql.execute(`CREATE TABLE IF NOT EXISTS visit_question_revisions (
    question_id TEXT PRIMARY KEY NOT NULL, revision INTEGER NOT NULL CHECK (revision > 0))`);
  await sql.execute(`INSERT OR IGNORE INTO visit_question_revisions (question_id, revision)
    SELECT id, 1 FROM visit_questions`);
  for (const operation of ['INSERT', 'UPDATE'] as const) {
    await sql.execute(`CREATE TRIGGER IF NOT EXISTS visit_questions_revision_${operation.toLowerCase()}
      AFTER ${operation} ON visit_questions BEGIN
      INSERT INTO visit_question_revisions (question_id, revision) VALUES (NEW.id, 1)
      ON CONFLICT(question_id) DO UPDATE SET revision = revision + 1; END`);
  }
  await sql.execute(`CREATE TABLE IF NOT EXISTS visit_question_records (
    id TEXT PRIMARY KEY NOT NULL, effective_at TEXT NOT NULL, recorded_at TEXT NOT NULL,
    ingested_at TEXT NOT NULL, payload_json TEXT NOT NULL CHECK (json_valid(payload_json)))`);
  await sql.execute(`CREATE INDEX IF NOT EXISTS visit_question_records_appointment_idx
    ON visit_question_records (json_extract(payload_json, '$.appointmentId'), id)`);
  await sql.execute(`CREATE TABLE IF NOT EXISTS visit_question_record_history (
    record_id TEXT NOT NULL, revision INTEGER NOT NULL, payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    PRIMARY KEY (record_id, revision))`);
  for (const operation of ['INSERT', 'UPDATE'] as const) {
    await sql.execute(`CREATE TRIGGER IF NOT EXISTS visit_question_records_history_${operation.toLowerCase()}
      AFTER ${operation} ON visit_question_records BEGIN
      INSERT INTO visit_question_record_history (record_id, revision, payload_json)
      VALUES (NEW.id, json_extract(NEW.payload_json, '$.revision'), NEW.payload_json); END`);
  }
  await sql.execute(`CREATE TRIGGER IF NOT EXISTS visit_question_record_history_immutable
    BEFORE UPDATE ON visit_question_record_history BEGIN
    SELECT RAISE(ABORT, 'Official visit history is append-only.'); END`);
  await sql.execute(`CREATE TRIGGER IF NOT EXISTS visit_question_records_delete_history
    AFTER DELETE ON visit_question_records BEGIN
    DELETE FROM visit_question_record_history WHERE record_id = OLD.id; END`);
  // Removing preparation or the visit cannot leave official answers orphaned or attached elsewhere.
  for (const [table, key] of [
    ['visit_questions', 'questionId'],
    ['appointments', 'appointmentId'],
  ]) {
    await sql.execute(`CREATE TRIGGER IF NOT EXISTS ${table}_delete_official_records
      AFTER DELETE ON ${table} BEGIN DELETE FROM visit_question_records
      WHERE json_extract(payload_json, '$.${key}') = OLD.id; END`);
  }
}
