import type { WorkflowSteeringAppliedReceipt } from '@orot/agent-runtime';
import { steeringReceiptTimes } from './conversationSteeringReceiptTimes';
import type { SqlDatabase, SqlExecutor } from '@orot/storage';

/** Persist delivery uncertainty before socket send, so a cold replay never resubmits it. */
export function createLiveSteering(input: {
  database: SqlDatabase;
  keys: string[];
  live(sql: SqlExecutor): Promise<boolean>;
  emit(receipt?: WorkflowSteeringAppliedReceipt): Promise<unknown>;
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
      const observedAt = new Date().toISOString();
      let changed = false;
      let receipt: WorkflowSteeringAppliedReceipt | undefined;
      await database.transaction(async sql => {
        if (!(await live(sql))) return;
        const row = (
          await sql.execute(
            `SELECT l.status, r.read_at FROM conversation_live_steering l
             LEFT JOIN conversation_steering_receipt_times r
             ON r.request_id=l.request_id AND r.run_id=l.run_id AND r.id=l.id
             WHERE l.request_id=? AND l.run_id=? AND l.id=? AND l.operation_id=?`,
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
        if (status !== 'failed') {
          // Preserve the first observation. Applied without an earlier accepted ack
          // establishes reading now, not an invented earlier transmission timestamp.
          const column = status === 'applied' ? 'read_at' : 'sent_at';
          await sql.execute(
            `INSERT INTO conversation_steering_receipt_times (request_id, run_id, id, ${column}) VALUES (?, ?, ?, ?)
             ON CONFLICT(request_id, run_id, id) DO UPDATE SET ${column}=COALESCE(${column}, excluded.${column})`,
            [...keys, id, observedAt],
          );
        }
        if (status === 'applied') {
          // The upsert preserves an existing timestamp, so publish the same value.
          const readAt = steeringReceiptTimes({
            read_at: row.read_at ?? observedAt,
          }).readAt;
          if (readAt) receipt = { id, readAt };
        }
        changed = true;
      });
      // A failed or rolled-back transaction cannot publish a Read receipt.
      if (changed) await emit(receipt);
      return changed;
    },
  };
}
