import { RecordIdSchema } from '@orot/domain';
import type { SqlDatabase, SqlExecutor } from './sql';

/** A deleted source retains a version fence so a late result cannot revive its binding. */
export async function createRecapBindingTables(sql: SqlExecutor): Promise<void> {
  await sql.execute(`CREATE TABLE IF NOT EXISTS recap_bindings (
    recording_id TEXT PRIMARY KEY NOT NULL, appointment_id TEXT,
    version INTEGER NOT NULL CHECK(version > 0), work_status TEXT NOT NULL DEFAULT 'pending')`);
  await sql.execute(`CREATE TABLE IF NOT EXISTS recap_results (
    recording_id TEXT PRIMARY KEY NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
    saved INTEGER NOT NULL DEFAULT 0 CHECK(saved IN (0, 1)))`);
  // Cached model output contains transcript-derived text and must follow its source's deletion.
  await sql.execute(`CREATE TRIGGER IF NOT EXISTS recap_binding_clear_result
    AFTER UPDATE OF appointment_id, version ON recap_bindings BEGIN DELETE FROM recap_results WHERE recording_id = NEW.recording_id; END`);
  for (const operation of ['INSERT', 'UPDATE', 'DELETE'] as const) {
    const row = operation === 'DELETE' ? 'OLD' : 'NEW';
    await sql.execute(`CREATE TRIGGER IF NOT EXISTS recap_transcript_clear_${operation.toLowerCase()}
      AFTER ${operation} ON transcript_segments BEGIN DELETE FROM recap_results
      WHERE recording_id = json_extract(${row}.payload_json, '$.recordingSourceId');
      UPDATE recap_bindings SET work_status = 'pending'
      WHERE recording_id = json_extract(${row}.payload_json, '$.recordingSourceId') AND appointment_id IS NOT NULL; END`);
    await sql.execute(`CREATE TRIGGER IF NOT EXISTS recap_question_clear_${operation.toLowerCase()}
      AFTER ${operation} ON visit_questions BEGIN DELETE FROM recap_results WHERE recording_id IN
      (SELECT recording_id FROM recap_bindings WHERE appointment_id = json_extract(${row}.payload_json, '$.appointmentId'));
      UPDATE recap_bindings SET work_status = 'pending'
      WHERE appointment_id = json_extract(${row}.payload_json, '$.appointmentId'); END`);
  }
  await sql.execute(`CREATE TRIGGER IF NOT EXISTS recap_question_clear_previous_visit
    AFTER UPDATE ON visit_questions BEGIN DELETE FROM recap_results WHERE recording_id IN
    (SELECT recording_id FROM recap_bindings WHERE appointment_id = json_extract(OLD.payload_json, '$.appointmentId'));
    UPDATE recap_bindings SET work_status = 'pending' WHERE appointment_id = json_extract(OLD.payload_json, '$.appointmentId'); END`);
  for (const [table, column] of [
    ['source_records', 'recording_id'],
    ['appointments', 'appointment_id'],
  ]) {
    await sql.execute(`CREATE TRIGGER IF NOT EXISTS ${table}_invalidate_recap_binding
      AFTER DELETE ON ${table} BEGIN UPDATE recap_bindings
      SET appointment_id = NULL, version = version + 1, work_status = 'not_linked' WHERE ${column} = OLD.id; END`);
  }
}

export async function readRecapBinding(sql: SqlExecutor, recordingId: string) {
  const rows = await sql.execute(
    'SELECT appointment_id, version FROM recap_bindings WHERE recording_id = ?',
    [RecordIdSchema.parse(recordingId)],
  );
  const row = rows.rows[0];
  if (!row || typeof row.appointment_id !== 'string') return null;
  return {
    appointmentId: row.appointment_id,
    binding: {
      fingerprint: `recap-binding:${JSON.stringify([recordingId, row.appointment_id])}`,
      version: Number(row.version),
    },
  };
}

/** Explicit unlink invalidates the association without reusing its version. */
export async function unbindRecordingFromVisit(database: SqlDatabase, recordingId: string) {
  // Increment the fence so a late analysis cannot revive the removed association.
  await database.execute(
    "UPDATE recap_bindings SET appointment_id = NULL, version = version + 1, work_status = 'not_linked' WHERE recording_id = ? AND appointment_id IS NOT NULL",
    [RecordIdSchema.parse(recordingId)],
  );
}

/** Explicit visit selection creates the binding; repeated selection is idempotent. */
export async function bindRecordingToVisit(
  database: SqlDatabase,
  recordingId: string,
  appointmentId: string,
): Promise<void> {
  RecordIdSchema.parse(recordingId);
  RecordIdSchema.parse(appointmentId);
  await database.transaction(async (sql) => {
    const source = await sql.execute(
      "SELECT id FROM source_records WHERE id = ? AND json_extract(payload_json, '$.sourceKind') = 'audio_recording'",
      [recordingId],
    );
    const visit = await sql.execute('SELECT id FROM appointments WHERE id = ?', [appointmentId]);
    if (!source.rows.length || !visit.rows.length)
      throw new Error('Recording or visit no longer exists.');
    await sql.execute(
      `INSERT INTO recap_bindings (recording_id, appointment_id, version) VALUES (?, ?, 1)
      ON CONFLICT(recording_id) DO UPDATE SET appointment_id = excluded.appointment_id,
      version = recap_bindings.version + 1, work_status = 'pending'
      WHERE recap_bindings.appointment_id IS NOT excluded.appointment_id`,
      [recordingId, appointmentId],
    );
  });
}
