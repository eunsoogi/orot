import type { SqlExecutor, SqlTransaction } from '@orot/storage';

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
    readonly authoredTerminal?: true;
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
  const identity = input.authoredTerminal
    ? authoredTerminalIdentity(
        input,
        input.sessionVersion,
        input.sourceRequestId,
      )
    : JSON.stringify([
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

/** Distinct from ordinary history and previous-answer operation receipts. The
 * nested tag cannot be interpreted as a legacy run ID. */
export function authoredTerminalIdentity(
  operation: ConversationActionIdentity,
  version: number,
  requestId: string,
): string {
  return JSON.stringify([
    ['remember-current-user-statement', '1', operation.operationRunId],
    operation.operationKey,
    version,
    requestId,
  ]);
}

export async function readConversationActionIdentity(
  sql: SqlExecutor,
  requestId: string,
  sessionId: string,
): Promise<string | undefined> {
  const exists = await sql.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'conversation_action_receipts'",
  );
  if (!exists.rows.length) return;
  const row = (
    await sql.execute(
      'SELECT identity_json FROM conversation_action_receipts WHERE request_id = ? AND session_id = ?',
      [requestId, sessionId],
    )
  ).rows[0];
  return typeof row?.identity_json === 'string' ? row.identity_json : undefined;
}
