import {
  toManualHistoryEvidence,
  type ManualHistoryEvidence,
} from '@orot/domain';
import { readManualHistoryEntry, type SqlDatabase } from '@orot/storage';
import type { ConversationHistorySave } from './conversationHealthHistory';
import { validateConversationHistorySource } from './conversationHistorySource';
import { conversationHistoryIntent } from '../manualHistory/conversationHistoryIntent';

/** Read an already committed result, never execute or backfill a missing receipt.
 * The workflow still owns fresh authorization and checkpoint identity. This port
 * proves only current local provenance and cannot make pending actions resumable.
 */
export async function recoverConversationHealthHistoryResult(
  database: SqlDatabase,
  supplied: ConversationHistorySave,
  signal: AbortSignal,
): Promise<{ id: string; evidence: ManualHistoryEvidence } | undefined> {
  const input = {
    ...supplied,
    operation: supplied.operation && { ...supplied.operation },
    approvedSource: supplied.approvedSource && { ...supplied.approvedSource },
  };
  if (!input.operation || signal.aborted) return undefined;
  const details =
    input.approvedSource?.text ?? conversationHistoryIntent(input.question);
  if (!details) return undefined;
  let result: { id: string; evidence: ManualHistoryEvidence } | undefined;
  await database.transaction(async tx => {
    if (signal.aborted) return;
    await validateConversationHistorySource(tx, input, details);
    const tables = await tx.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('conversation_history_receipts', 'conversation_action_receipts')",
    );
    if (tables.rows.length !== 2) return;
    const rows = await tx.execute(
      'SELECT h.entry_id, h.source_request_id, a.identity_json FROM conversation_history_receipts h ' +
        'JOIN conversation_action_receipts a ON a.request_id = h.request_id AND a.session_id = h.session_id ' +
        'WHERE h.request_id = ? AND h.session_id = ?',
      [input.requestId, input.sessionId],
    );
    const row = rows.rows[0];
    const sourceId = input.approvedSource?.requestId ?? input.requestId;
    const identity = JSON.stringify([
      input.operation!.operationRunId,
      input.operation!.operationKey,
      input.sessionVersion,
      sourceId,
    ]);
    if (
      !row ||
      row.identity_json !== identity ||
      row.source_request_id !== sourceId
    )
      return;
    const id = String(row.entry_id);
    const entry = await readManualHistoryEntry(tx, id);
    if (!entry || entry.details !== details) return;
    const corrections = await tx.execute(
      'SELECT id FROM manual_history_entries WHERE supersedes_id = ? LIMIT 1',
      [id],
    );
    if (corrections.rows.length || signal.aborted) return;
    result = { id, evidence: toManualHistoryEvidence(entry) };
  });
  return signal.aborted ? undefined : result;
}

/** Backward-compatible receipt ID reader used by already-checkpointed result recovery. */
export async function recoverConversationHealthHistory(
  database: SqlDatabase,
  supplied: ConversationHistorySave,
  signal: AbortSignal,
): Promise<string | undefined> {
  return (
    await recoverConversationHealthHistoryResult(database, supplied, signal)
  )?.id;
}
