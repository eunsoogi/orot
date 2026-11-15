import type { SqlTransaction } from '@orot/storage';
import type { ConversationHistorySave } from './conversationHealthHistory';
import {
  actionRecoveryStageMatches,
  type ConversationActionRecoveryStage,
} from './conversationActionRecoveryStorage';

/** Called inside the domain write transaction, after both domain and exact action
 * receipts exist. No stage means no recovery marker. This never authorizes a claim
 * or rebinding to a new operation, and cannot commit independently of the write.
 */
export async function commitConversationActionRecovery(
  tx: SqlTransaction,
  input: ConversationHistorySave,
  entryId: string,
): Promise<void> {
  if (!input.operation) return;
  const exists = await tx.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'conversation_action_recovery'",
  );
  if (!exists.rows.length) return;
  const row = (
    await tx.execute(
      'SELECT payload, status, entry_id FROM conversation_action_recovery WHERE request_id = ?',
      [input.requestId],
    )
  ).rows[0];
  if (!row) return;
  const d: ConversationActionRecoveryStage = JSON.parse(String(row.payload));
  if (
    d.manifest.requestId !== input.requestId ||
    d.manifest.sessionId !== input.sessionId ||
    d.manifest.sessionVersion !== input.sessionVersion ||
    d.manifest.operationRunId !== input.operation.operationRunId ||
    d.operationKey !== input.operation.operationKey ||
    d.sourceRequestId !==
      (input.approvedSource?.requestId ?? input.requestId) ||
    !(await actionRecoveryStageMatches(tx, d))
  )
    throw new Error('Committed action recovery ownership changed.');
  const receipt = (
    await tx.execute(
      `SELECT h.entry_id, a.identity_json FROM conversation_history_receipts h
     JOIN conversation_action_receipts a ON a.request_id = h.request_id AND a.session_id = h.session_id
     WHERE h.request_id = ? AND h.session_id = ?`,
      [input.requestId, input.sessionId],
    )
  ).rows[0];
  const identity = JSON.stringify([
    input.operation.operationRunId,
    input.operation.operationKey,
    input.sessionVersion,
    d.sourceRequestId,
  ]);
  if (
    receipt?.entry_id !== entryId ||
    receipt.identity_json !== identity ||
    (row.status === 'committed' && row.entry_id !== entryId)
  )
    throw new Error('Committed action recovery receipt changed.');
  await tx.execute(
    "UPDATE conversation_action_recovery SET status = 'committed', entry_id = ? WHERE request_id = ? AND payload = ?",
    [entryId, input.requestId, String(row.payload)],
  );
}
