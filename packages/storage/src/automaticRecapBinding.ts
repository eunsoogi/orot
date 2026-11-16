import { RecordIdSchema, TimestampSchema } from '@orot/domain';
import type { SqlDatabase } from './sql';

export interface AutomaticVisitSnapshot {
  readonly id: string;
  readonly effectiveAt: string;
  readonly status: 'scheduled';
}

/** Check the captured appointment inside the same transaction that inserts the binding.
 * Automatic selection never replaces a manual choice or revives an explicit unlink. */
export async function bindRecordingToUnchangedVisit(
  database: SqlDatabase,
  recordingId: string,
  selected: AutomaticVisitSnapshot,
): Promise<boolean> {
  if (
    !RecordIdSchema.safeParse(recordingId).success ||
    !RecordIdSchema.safeParse(selected.id).success ||
    !TimestampSchema.safeParse(selected.effectiveAt).success ||
    selected.status !== 'scheduled'
  )
    return false;
  let bound = false;
  await database.transaction(async (sql) => {
    const source = await sql.execute(
      "SELECT id FROM source_records WHERE id = ? AND json_extract(payload_json, '$.sourceKind') = 'audio_recording'",
      [recordingId],
    );
    const visit = await sql.execute(
      "SELECT id FROM appointments WHERE id = ? AND json_extract(payload_json, '$.effectiveAt') = ? AND json_extract(payload_json, '$.status') = 'scheduled'",
      [selected.id, selected.effectiveAt],
    );
    if (!source.rows.length || !visit.rows.length) return;
    await sql.execute(
      `INSERT INTO recap_bindings (recording_id, appointment_id, version) VALUES (?, ?, 1)
       ON CONFLICT(recording_id) DO NOTHING`,
      [recordingId, selected.id],
    );
    const binding = await sql.execute(
      'SELECT appointment_id FROM recap_bindings WHERE recording_id = ?',
      [recordingId],
    );
    bound = binding.rows[0]?.appointment_id === selected.id;
  });
  return bound;
}
