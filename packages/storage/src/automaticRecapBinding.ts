import { RecordIdSchema, TimestampSchema } from '@orot/domain';
import type { SqlDatabase } from './sql';

class AutomaticBindingExpired extends Error {}

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
  canCommit: () => boolean = () => true,
): Promise<boolean> {
  if (
    !RecordIdSchema.safeParse(recordingId).success ||
    !RecordIdSchema.safeParse(selected.id).success ||
    !TimestampSchema.safeParse(selected.effectiveAt).success ||
    selected.status !== 'scheduled'
  )
    return false;
  if (!canCommit()) return false;
  let bound = false;
  try {
    await database.transaction(async (sql) => {
      // The transaction may have waited behind another operation after the UI deadline.
      if (!canCommit()) return;
      const source = await sql.execute(
        "SELECT id FROM source_records WHERE id = ? AND json_extract(payload_json, '$.sourceKind') = 'audio_recording'",
        [recordingId],
      );
      const visit = await sql.execute(
        "SELECT id FROM appointments WHERE id = ? AND json_extract(payload_json, '$.effectiveAt') = ? AND json_extract(payload_json, '$.status') = 'scheduled'",
        [selected.id, selected.effectiveAt],
      );
      if (!source.rows.length || !visit.rows.length || !canCommit()) return;
      await sql.execute(
        `INSERT INTO recap_bindings (recording_id, appointment_id, version) VALUES (?, ?, 1)
       ON CONFLICT(recording_id) DO NOTHING`,
        [recordingId, selected.id],
      );
      const binding = await sql.execute(
        'SELECT appointment_id FROM recap_bindings WHERE recording_id = ?',
        [recordingId],
      );
      // Throwing rolls back an insertion that completed after cancellation/deadline.
      // Never swallow actual storage failures or errors from the caller's guard.
      if (!canCommit()) throw new AutomaticBindingExpired();
      bound = binding.rows[0]?.appointment_id === selected.id;
    });
  } catch (error) {
    if (error instanceof AutomaticBindingExpired) return false;
    throw error;
  }
  return bound;
}
