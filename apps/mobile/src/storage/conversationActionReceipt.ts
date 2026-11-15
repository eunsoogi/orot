import type { SqlTransaction } from '@orot/storage';

/** Execution identity is supplied by the workflow, never by model output. */
export interface ConversationActionIdentity {
  readonly operationRunId: string;
  readonly operationKey: string;
}

/** Bind a domain receipt to its exact invocation in the same write transaction.
 * This does not authorize replay or recover an uncertain write. Legacy receipts
 * deliberately cannot acquire a new execution identity after the fact.
 */
export async function bindConversationActionReceipt(
  tx: SqlTransaction,
  input: ConversationActionIdentity & {
    readonly requestId: string;
    readonly sessionId: string;
    readonly sessionVersion: number;
    readonly sourceRequestId: string;
  },
  existing: boolean,
): Promise<void> {
  if (!input.operationRunId.trim() || !input.operationKey.trim())
    throw new Error('An exact action execution identity is required.');
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS conversation_action_receipts ' +
      '(request_id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL, identity_json TEXT NOT NULL)',
  );
  await tx.execute(
    'CREATE TRIGGER IF NOT EXISTS conversation_action_session_removed AFTER DELETE ON conversation_artifact_sessions BEGIN DELETE FROM conversation_action_receipts WHERE session_id = OLD.id; END',
  );
  // Do not duplicate health prose into a tombstone that outlives history deletion.
  // Current source and domain entry content are checked separately in the transaction.
  const identity = JSON.stringify([
    input.operationRunId,
    input.operationKey,
    input.sessionVersion,
    input.sourceRequestId,
  ]);
  const rows = await tx.execute(
    'SELECT session_id, identity_json FROM conversation_action_receipts WHERE request_id = ?',
    [input.requestId],
  );
  if (existing) {
    if (
      rows.rows[0]?.session_id !== input.sessionId ||
      rows.rows[0]?.identity_json !== identity
    )
      throw new Error(
        'The saved action belongs to another or unknown execution.',
      );
    return;
  }
  if (rows.rows.length)
    throw new Error('The action receipt has no matching domain result.');
  await tx.execute(
    'INSERT INTO conversation_action_receipts VALUES (?, ?, ?)',
    [input.requestId, input.sessionId, identity],
  );
}
