import type { SqlDatabase, SqlExecutor } from '@orot/storage';

/** Persist delivery uncertainty before socket send, so a cold replay never resubmits it. */
export function createLiveSteering(input: {
  database: SqlDatabase;
  keys: string[];
  live(sql: SqlExecutor): Promise<boolean>;
  emit(): Promise<unknown>;
}) {
  const { database, keys, live, emit } = input;
  return {
    async beginLive(operationId: string, id: string): Promise<boolean> {
      let claimed = false;
      await database.transaction(async sql => {
        if (!(await live(sql))) return;
        const pending = (
          await sql.execute(
            "SELECT operation_id FROM conversation_operation_journal WHERE request_id=? AND run_id=? AND operation_id=? AND status='pending' AND (purpose IS NULL OR purpose <> 'preview_review')",
            [...keys, operationId],
          )
        ).rows[0];
        const row = (
          await sql.execute(
            'SELECT status FROM conversation_steering WHERE request_id=? AND run_id=? AND id=?',
            [...keys, id],
          )
        ).rows[0];
        const prior = (
          await sql.execute(
            'SELECT id FROM conversation_live_steering WHERE request_id=? AND run_id=? AND id=?',
            [...keys, id],
          )
        ).rows[0];
        if (!pending || row?.status !== 'queued' || prior) return;
        await sql.execute(
          'INSERT INTO conversation_live_steering VALUES (?, ?, ?, ?, ?)',
          [...keys, id, operationId, 'sent'],
        );
        await sql.execute(
          "UPDATE conversation_steering SET status='delivery_pending' WHERE request_id=? AND run_id=? AND id=?",
          [...keys, id],
        );
        claimed = true;
      });
      if (claimed) await emit();
      return claimed;
    },
    async settleLive(
      operationId: string,
      id: string,
      status: 'accepted' | 'applied' | 'pending' | 'failed',
    ): Promise<boolean> {
      let changed = false;
      await database.transaction(async sql => {
        if (!(await live(sql))) return;
        const row = (
          await sql.execute(
            'SELECT status FROM conversation_live_steering WHERE request_id=? AND run_id=? AND id=? AND operation_id=?',
            [...keys, id, operationId],
          )
        ).rows[0];
        // Applied means server continuation committed the instruction. A late failure cannot undo it.
        if (!row || row.status === 'applied' || row.status === 'failed') return;
        await sql.execute(
          'UPDATE conversation_live_steering SET status=? WHERE request_id=? AND run_id=? AND id=?',
          [status, ...keys, id],
        );
        await sql.execute(
          'UPDATE conversation_steering SET status=? WHERE request_id=? AND run_id=? AND id=?',
          [
            status === 'applied'
              ? 'applied'
              : status === 'failed'
                ? 'not_applied'
                : 'delivery_pending',
            ...keys,
            id,
          ],
        );
        changed = true;
      });
      if (changed) await emit();
      return changed;
    },
  };
}
