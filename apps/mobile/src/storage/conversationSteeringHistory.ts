import type { SqlDatabase } from '@orot/storage';
import type { StoredSteeringInstruction } from './conversationSteeringStorage';
import { steeringReceiptTimes } from './conversationSteeringReceiptTimes';

/** Display-only receipts for a validated completed turn; never returns bindings or resume authority. */
export function conversationSteeringHistory(
  database: SqlDatabase,
  ensure: () => Promise<void>,
) {
  return async (
    sessionId: string,
    version: number,
    requestId: string,
    signal: AbortSignal,
  ): Promise<readonly StoredSteeringInstruction[]> => {
    await ensure();
    let restored: readonly StoredSteeringInstruction[] = [];
    await database.transaction(async sql => {
      if (signal.aborted) return;
      const table = await sql.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('conversation_steering', 'conversation_live_steering', 'conversation_steering_receipt_times')",
      );
      if (!table.rows.some(row => row.name === 'conversation_steering')) return;
      const hasLive = table.rows.some(
        row => row.name === 'conversation_live_steering',
      );
      const hasTimes = table.rows.some(
        row => row.name === 'conversation_steering_receipt_times',
      );
      const result = await sql.execute(
        `SELECT q.id, q.text, q.sequence, q.status, ${hasLive ? 'l.status' : 'NULL'} AS live_status, ${hasTimes ? 't.submitted_at, t.sent_at, t.read_at' : 'NULL AS submitted_at, NULL AS sent_at, NULL AS read_at'} FROM conversation_steering q
        ${hasLive ? 'LEFT JOIN conversation_live_steering l ON l.request_id=q.request_id AND l.run_id=q.run_id AND l.id=q.id' : ''}
        ${hasTimes ? 'LEFT JOIN conversation_steering_receipt_times t ON t.request_id=q.request_id AND t.run_id=q.run_id AND t.id=q.id' : ''}
        JOIN conversation_requests r ON r.id = q.request_id
        JOIN conversation_artifact_sessions s ON s.id = r.session_id
        JOIN conversation_artifact_generation g ON g.singleton = 1
        WHERE r.id = ? AND r.session_id = ? AND r.session_version = ? AND r.status = 'completed'
        AND s.version = ? AND s.hidden = 0 AND s.generation = g.generation
        ORDER BY q.sequence LIMIT 17`,
        [requestId, sessionId, version, version],
      );
      if (signal.aborted || result.rows.length > 16) return;
      const rows: StoredSteeringInstruction[] = [];
      for (const row of result.rows) {
        if (
          typeof row.id !== 'string' ||
          typeof row.text !== 'string' ||
          row.text.length > 1000 ||
          typeof row.sequence !== 'number' ||
          !Number.isSafeInteger(row.sequence) ||
          row.sequence < 1 ||
          (row.status !== 'applied' &&
            row.status !== 'not_applied' &&
            row.status !== 'delivery_pending')
        )
          return;
        rows.push({
          id: row.id,
          text: row.text,
          sequence: row.sequence,
          status: row.status,
          ...steeringReceiptTimes(row),
          ...(row.live_status === 'accepted' || row.live_status === 'pending'
            ? { serverAccepted: true }
            : {}),
        });
      }
      restored = rows;
    });
    return signal.aborted ? [] : restored;
  };
}
