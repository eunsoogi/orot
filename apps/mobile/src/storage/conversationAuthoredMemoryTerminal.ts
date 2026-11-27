import {
  isExactStandingAuthoredMemorySentence,
  standingAuthoredMemoryIsCurrent,
} from './standingAuthoredMemoryApproval';
import {
  localConversationMemoryIdPrefix,
  readManualHistoryEntry,
  type SqlDatabase,
} from '@orot/storage';
import { exactAuthoredMemorySentence } from './authoredMemorySelection';
import {
  authoredTerminalIdentity,
  readConversationActionIdentity,
  type ConversationActionIdentity,
} from './conversationActionReceipt';
import type { ConversationHistorySave } from './conversationHealthHistory';

export function validAuthoredMemoryTerminal(
  value: ConversationActionIdentity,
): boolean {
  return (
    typeof value.operationRunId === 'string' &&
    value.operationRunId.trim() === value.operationRunId &&
    value.operationRunId.length > 0 &&
    value.operationRunId.length <= 300 &&
    typeof value.operationKey === 'string' &&
    /^tool-[1-9]\d*$/u.test(value.operationKey) &&
    Number.isSafeInteger(Number(value.operationKey.slice(5)))
  );
}

/** Reads only an exact live durable command and matching uncorrected local note.
 * Does not create tables, replay the write, or recover a finished conversation. */
export async function confirmAuthoredMemoryTerminal(
  database: SqlDatabase,
  input: ConversationHistorySave,
  signal: AbortSignal,
): Promise<boolean> {
  const op = input.authoredTerminal;
  const approved = input.approvedCurrentSentence;
  const exact = input.standingApproval
    ? isExactStandingAuthoredMemorySentence
    : exactAuthoredMemorySentence;
  const current = () => !signal.aborted && approved?.current() === true;
  if (
    !op ||
    !validAuthoredMemoryTerminal(op) ||
    input.localOnly !== true ||
    input.operation ||
    input.approvedSource ||
    !approved ||
    !current() ||
    !exact(input.question, approved.statement)
  )
    return false;
  const id = localConversationMemoryIdPrefix + input.requestId;
  let confirmed = false;
  await database.transaction(async tx => {
    if (
      !current() ||
      (await readConversationActionIdentity(
        tx,
        input.requestId,
        input.sessionId,
      )) !== authoredTerminalIdentity(op, input.sessionVersion, input.requestId)
    )
      return;
    const receipt = await tx.execute(
      `SELECT 1 FROM conversation_history_receipts h
       JOIN conversation_requests r ON r.id = h.request_id AND r.session_id = h.session_id
       JOIN conversation_artifact_sessions s ON s.id = r.session_id
       WHERE h.request_id = ? AND h.session_id = ? AND h.entry_id = ?
       AND h.source_request_id = h.request_id AND r.session_version = ?
       AND s.version = r.session_version AND s.hidden = 0 AND r.status = 'active'
       AND r.question = ?`,
      [
        input.requestId,
        input.sessionId,
        id,
        input.sessionVersion,
        input.question,
      ],
    );
    if (
      !receipt.rows.length ||
      (await readManualHistoryEntry(tx, id))?.details !== approved.statement
    )
      return;
    const newer = await tx.execute(
      'SELECT 1 FROM manual_history_entries WHERE supersedes_id = ? LIMIT 1',
      [id],
    );
    if (newer.rows.length || !current()) return;
    if (
      input.standingApproval &&
      !(await standingAuthoredMemoryIsCurrent(
        tx,
        input.question,
        approved.statement,
        input.standingApproval,
      ))
    )
      return;
    if (!current() || input.standingApproval?.current() === false) return;
    tx.commit();
    confirmed = true;
  });
  return confirmed && current();
}
