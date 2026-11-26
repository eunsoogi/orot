import type { SqlDatabase, SqlExecutor } from '@orot/storage';

export type AnswerMemoryTerminalOperation = {
  readonly operationRunId: string;
  readonly operationKey: string;
  readonly toolId: 'remember-conversation-answer';
  readonly toolVersion: '1';
};

export type AnswerMemoryTerminalBinding = {
  readonly currentRequestId: string;
  readonly owner: { readonly id: string; readonly version: number };
  readonly id: string;
};

export type AnswerMemoryBookmarkDisposition = 'saved' | 'already_saved';

const table = 'saved_conversation_answer_terminal_receipts';
const insertBookmark =
  'INSERT INTO saved_conversation_answer_refs VALUES (?,?) ON CONFLICT(artifact_id) DO NOTHING';

export async function writeLegacyAnswerBookmark(tx: SqlExecutor, id: string) {
  await tx.execute(insertBookmark, [id, new Date().toISOString()]);
  return 'saved' as const;
}

export function validAnswerMemoryTerminalOperation(
  value: unknown,
): value is AnswerMemoryTerminalOperation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const op = value as Partial<AnswerMemoryTerminalOperation>;
  return (
    typeof op.operationRunId === 'string' &&
    op.operationRunId.trim() === op.operationRunId &&
    op.operationRunId.length > 0 &&
    op.operationRunId.length <= 300 &&
    typeof op.operationKey === 'string' &&
    /^tool-[1-9]\d*$/u.test(op.operationKey) &&
    Number.isSafeInteger(Number(op.operationKey.slice(5))) &&
    op.toolId === 'remember-conversation-answer' &&
    op.toolVersion === '1'
  );
}

export function sameAnswerMemoryTerminalOperation(
  expected: AnswerMemoryTerminalOperation,
  supplied: AnswerMemoryTerminalOperation,
): boolean {
  return (
    validAnswerMemoryTerminalOperation(supplied) &&
    expected.operationRunId === supplied.operationRunId &&
    expected.operationKey === supplied.operationKey &&
    expected.toolId === supplied.toolId &&
    expected.toolVersion === supplied.toolVersion
  );
}

const fields = (
  input: AnswerMemoryTerminalBinding,
  op: AnswerMemoryTerminalOperation,
) => [
  input.currentRequestId,
  input.owner.id,
  input.owner.version,
  op.operationRunId,
  op.operationKey,
  op.toolId,
  op.toolVersion,
  input.id,
];

/** Private identity only. A retired pin clears its source identity, not the
 * request's at-most-once fence. Request/session removal can purge the fence. */
export async function writeTerminalAnswerBookmark(
  tx: SqlExecutor,
  input: AnswerMemoryTerminalBinding,
  op: AnswerMemoryTerminalOperation,
): Promise<AnswerMemoryBookmarkDisposition | undefined> {
  await tx.execute(`CREATE TABLE IF NOT EXISTS ${table} (
    request_id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL,
    session_version INTEGER NOT NULL, run_id TEXT NOT NULL, operation_key TEXT NOT NULL,
    tool_id TEXT NOT NULL, tool_version TEXT NOT NULL, artifact_id TEXT,
    disposition TEXT NOT NULL CHECK(disposition IN ('saved','already_saved')),
    UNIQUE(run_id,operation_key)
  )`);
  await tx.execute(`CREATE TRIGGER IF NOT EXISTS saved_answer_terminal_ref_removed
    AFTER DELETE ON saved_conversation_answer_refs BEGIN
      UPDATE ${table} SET artifact_id=NULL WHERE artifact_id=OLD.artifact_id;
    END`);
  await tx.execute(`CREATE TRIGGER IF NOT EXISTS saved_answer_terminal_request_removed
    AFTER DELETE ON conversation_requests BEGIN
      DELETE FROM ${table} WHERE request_id=OLD.id;
    END`);
  await tx.execute(`CREATE TRIGGER IF NOT EXISTS saved_answer_terminal_session_removed
    AFTER DELETE ON conversation_artifact_sessions BEGIN
      DELETE FROM ${table} WHERE session_id=OLD.id;
    END`);
  const used = await tx.execute(
    `SELECT 1 FROM ${table} WHERE request_id=? OR (run_id=? AND operation_key=?)`,
    [input.currentRequestId, op.operationRunId, op.operationKey],
  );
  if (used.rows.length) return;
  const bookmark = await tx.execute(insertBookmark, [
    input.id,
    new Date().toISOString(),
  ]);
  const disposition =
    bookmark.rowsAffected === 1
      ? 'saved'
      : bookmark.rowsAffected === 0
        ? 'already_saved'
        : undefined;
  if (!disposition) throw new Error('Could not prove the answer bookmark.');
  const receipt = await tx.execute(
    `INSERT INTO ${table} VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [...fields(input, op), disposition],
  );
  if (
    receipt.rowsAffected !== 1 ||
    (await readTerminalAnswerBookmark(tx, input, op)) !== disposition
  )
    throw new Error('The answer bookmark receipt could not be committed.');
  return disposition;
}

/** Caller revalidates the original and the live request within this transaction. */
export async function readTerminalAnswerBookmark(
  tx: SqlExecutor,
  input: AnswerMemoryTerminalBinding,
  op: AnswerMemoryTerminalOperation,
): Promise<AnswerMemoryBookmarkDisposition | undefined> {
  const exists = await tx.execute(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
    [table],
  );
  if (!exists.rows.length) return;
  const receipt = await tx.execute(
    `SELECT r.disposition FROM ${table} r JOIN saved_conversation_answer_refs b
       ON b.artifact_id=r.artifact_id
     WHERE r.request_id=? AND r.session_id=? AND r.session_version=? AND r.run_id=?
       AND r.operation_key=? AND r.tool_id=? AND r.tool_version=? AND r.artifact_id=?`,
    fields(input, op),
  );
  const disposition = receipt.rows.length === 1 && receipt.rows[0]?.disposition;
  return disposition === 'saved' || disposition === 'already_saved'
    ? disposition
    : undefined;
}

export async function confirmTerminalAnswerBookmark(
  database: SqlDatabase,
  input: AnswerMemoryTerminalBinding & { readonly current: () => boolean },
  op: AnswerMemoryTerminalOperation | undefined,
  offered: AnswerMemoryTerminalOperation,
  admit: (tx: SqlExecutor) => Promise<unknown>,
): Promise<AnswerMemoryBookmarkDisposition | undefined> {
  if (
    !op ||
    !sameAnswerMemoryTerminalOperation(op, offered) ||
    !input.current()
  )
    return;
  let matched: AnswerMemoryBookmarkDisposition | undefined;
  try {
    await database.transaction(async tx => {
      if (!(await admit(tx))) return;
      const found = await readTerminalAnswerBookmark(tx, input, op);
      if (!found || !(await admit(tx)) || !input.current()) return;
      // This terminal acknowledgement is not an ordinary answer artifact.
      // Close only the exact still-active request whose pin just revalidated.
      const settled = await tx.execute(
        `UPDATE conversation_requests
         SET status = 'completed'
         WHERE id = ? AND session_id = ? AND session_version = ?
           AND status = 'active' AND input_json IS NULL
           AND interruption_reason IS NULL AND local_outcome_json IS NULL`,
        [input.currentRequestId, input.owner.id, input.owner.version],
      );
      if (settled.rowsAffected !== 1 || !input.current())
        throw new Error('The answer bookmark request is no longer owned.');
      tx.commit();
      matched = found;
    });
    return input.current() ? matched : undefined;
  } catch {
    // A settlement error after the synchronous commit cannot undo that commit.
    return input.current() ? matched : undefined;
  }
}
