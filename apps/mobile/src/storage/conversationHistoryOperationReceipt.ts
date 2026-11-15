import type { SqlExecutor, SqlTransaction } from '@orot/storage';
import type { ConversationHistorySave } from './conversationHealthHistory';

const table = 'conversation_history_operation_receipts';
const source = (i: ConversationHistorySave) =>
  i.approvedSource?.requestId ?? i.requestId;
const ordinal = (key: unknown): number => {
  if (typeof key !== 'string' || !/^tool-[1-9]\d*$/.test(key)) return NaN;
  const value = Number(key.slice(5));
  return Number.isSafeInteger(value) ? value : NaN;
};

/** Later operations have independent immutable fences. Legacy identities are never
 * backfilled; deleting health content must not make an old operation writable again. */
export async function setupHistoryOperationReceipts(tx: SqlTransaction) {
  await tx.execute(`CREATE TABLE IF NOT EXISTS ${table} (
    request_id TEXT NOT NULL, operation_run_id TEXT NOT NULL, operation_key TEXT NOT NULL,
    session_id TEXT NOT NULL, session_version INTEGER NOT NULL,
    source_request_id TEXT NOT NULL, entry_id TEXT NOT NULL,
    PRIMARY KEY(request_id, operation_run_id, operation_key),
    UNIQUE(request_id, source_request_id))`);
  await tx.execute(`CREATE TRIGGER IF NOT EXISTS history_operation_session_removed
    AFTER DELETE ON conversation_artifact_sessions BEGIN
    DELETE FROM ${table} WHERE session_id = OLD.id; END`);
}

export async function readHistoryOperationReceipt(
  sql: SqlExecutor,
  input: ConversationHistorySave,
) {
  if (!input.operation) return undefined;
  const exists = await sql.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    [table],
  );
  if (!exists.rows.length) return undefined;
  const row = (
    await sql.execute(
      `SELECT * FROM ${table} WHERE request_id=? AND operation_run_id=? AND operation_key=?`,
      [
        input.requestId,
        input.operation.operationRunId,
        input.operation.operationKey,
      ],
    )
  ).rows[0];
  if (
    !row ||
    row.session_id !== input.sessionId ||
    row.session_version !== input.sessionVersion ||
    row.source_request_id !== source(input)
  )
    return undefined;
  return String(row.entry_id);
}

/** Return undefined for the original legacy invocation; otherwise reserve only a
 * distinct approved source under a later ordinal in the same original run. */
export async function additionalHistoryOperation(
  tx: SqlTransaction,
  input: ConversationHistorySave,
): Promise<{ id: string; existing: boolean } | undefined> {
  if (!input.operation) return undefined;
  const exists = await tx.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_action_receipts'",
  );
  if (!exists.rows.length) return undefined;
  const first = (
    await tx.execute(
      'SELECT a.identity_json, a.session_id, h.source_request_id FROM conversation_action_receipts a JOIN conversation_history_receipts h ON a.request_id=h.request_id AND a.session_id=h.session_id WHERE a.request_id=?',
      [input.requestId],
    )
  ).rows[0];
  if (!first) return undefined;
  const identity: unknown[] = JSON.parse(String(first.identity_json));
  const op = input.operation;
  if (identity[0] === op.operationRunId && identity[1] === op.operationKey)
    return undefined;
  const reject = () => {
    throw new Error(
      'The saved action belongs to another or unknown execution.',
    );
  };
  if (
    first.session_id !== input.sessionId ||
    identity[0] !== op.operationRunId ||
    identity[2] !== input.sessionVersion ||
    identity[3] !== first.source_request_id ||
    !Number.isFinite(ordinal(identity[1])) ||
    !Number.isFinite(ordinal(op.operationKey))
  )
    return reject();
  await setupHistoryOperationReceipts(tx);
  const rows = (
    await tx.execute(`SELECT * FROM ${table} WHERE request_id=?`, [
      input.requestId,
    ])
  ).rows;
  const exact = rows.find(
    row =>
      row.operation_run_id === op.operationRunId &&
      row.operation_key === op.operationKey,
  );
  if (exact) {
    if (
      exact.session_id !== input.sessionId ||
      exact.session_version !== input.sessionVersion ||
      exact.source_request_id !== source(input)
    )
      return reject();
    return { id: String(exact.entry_id), existing: true };
  }
  if (
    source(input) === first.source_request_id ||
    rows.some(
      row =>
        row.source_request_id === source(input) ||
        row.operation_run_id !== op.operationRunId ||
        row.session_id !== input.sessionId ||
        row.session_version !== input.sessionVersion ||
        !Number.isFinite(ordinal(row.operation_key)) ||
        ordinal(row.operation_key) >= ordinal(op.operationKey),
    ) ||
    ordinal(identity[1]) >= ordinal(op.operationKey)
  )
    return reject();
  return {
    id:
      'conversation-history-operation:' +
      encodeURIComponent(
        JSON.stringify([input.requestId, op.operationRunId, op.operationKey]),
      ),
    existing: false,
  };
}

export async function insertHistoryOperationReceipt(
  tx: SqlTransaction,
  input: ConversationHistorySave,
  id: string,
) {
  await tx.execute(`INSERT INTO ${table} VALUES (?, ?, ?, ?, ?, ?, ?)`, [
    input.requestId,
    input.operation!.operationRunId,
    input.operation!.operationKey,
    input.sessionId,
    input.sessionVersion,
    source(input),
    id,
  ]);
}
