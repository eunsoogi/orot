import { RecapResultSchema } from '@orot/domain';
import type { RecapResult } from '@orot/domain';
import type { SqlDatabase } from './sql';
import { loadCurrentRecapInput } from './recapInput';
import { requireCurrentRecap } from './visitQuestionRecordValidation';

/** Cache validated output before official writes so a failed save can retry without inference. */
export async function cacheRecapResult(database: SqlDatabase, value: RecapResult): Promise<void> {
  const result = RecapResultSchema.parse(value);
  await database.transaction(async (sql) => {
    const input = await loadCurrentRecapInput(sql, result.recordingSourceId);
    if (!input) throw new Error('The recording is no longer linked to a visit.');
    await requireCurrentRecap(sql, result, input);
    await sql.execute(
      `INSERT INTO recap_results (recording_id, payload_json) VALUES (?, ?)
      ON CONFLICT(recording_id) DO UPDATE SET payload_json = excluded.payload_json, saved = 0`,
      [result.recordingSourceId, JSON.stringify(result)],
    );
  });
}

/** Report saved only after the official write and a second transactional freshness check. */
export async function markRecapSaved(database: SqlDatabase, value: RecapResult): Promise<void> {
  const result = RecapResultSchema.parse(value);
  await database.transaction(async (sql) => {
    const input = await loadCurrentRecapInput(sql, result.recordingSourceId);
    if (!input) throw new Error('The recording is no longer linked to a visit.');
    await requireCurrentRecap(sql, result, input);
    const rows = await sql.execute(
      'SELECT payload_json FROM recap_results WHERE recording_id = ?',
      [result.recordingSourceId],
    );
    if (String(rows.rows[0]?.payload_json) !== JSON.stringify(result))
      throw new Error('The cached Recap changed before saving.');
    await sql.execute('UPDATE recap_results SET saved = 1 WHERE recording_id = ?', [
      result.recordingSourceId,
    ]);
    await sql.execute("UPDATE recap_bindings SET work_status = 'saved' WHERE recording_id = ?", [
      result.recordingSourceId,
    ]);
  });
}

/** A retained cache is usable only while every source and the explicit binding remain current. */
export async function readCurrentRecapResult(
  database: SqlDatabase,
  recordingId: string,
): Promise<RecapResult | null> {
  let result: RecapResult | null = null;
  await database.transaction(async (sql) => {
    const rows = await sql.execute(
      'SELECT payload_json FROM recap_results WHERE recording_id = ?',
      [recordingId],
    );
    if (!rows.rows.length) return;
    const candidate = RecapResultSchema.parse(JSON.parse(String(rows.rows[0].payload_json)));
    const input = await loadCurrentRecapInput(sql, recordingId);
    if (!input) return;
    await requireCurrentRecap(sql, candidate, input);
    result = candidate;
  });
  return result;
}
