import { readManualHistoryEntry, type SqlExecutor } from '@orot/storage';
import { stableJson } from '../aiFeatures/integration/evidenceUtils';
import { conversationHistoryIntent } from '../manualHistory/conversationHistoryIntent';
import {
  actionRecoveryStageMatches,
  type ConversationActionRecoveryStage,
} from './conversationActionRecoveryStorage';
import {
  isDifferentConversationProcess,
  type ConversationProcessIdentity,
} from '../ragConversation/conversationProcessIdentity';

export interface CommittedActionRecoveryDescriptor {
  readonly stage: ConversationActionRecoveryStage;
  readonly entryId: string;
}

/** Data-only verification. A marker proves a domain commit, not a new write grant. */
export async function readCommittedActionRecovery(
  sql: SqlExecutor,
  requestId: string,
  process: ConversationProcessIdentity,
): Promise<CommittedActionRecoveryDescriptor | undefined> {
  const row = (
    await sql.execute(
      "SELECT payload, entry_id, epoch FROM conversation_action_recovery WHERE request_id = ? AND status = 'committed'",
      [requestId],
    )
  ).rows[0];
  if (
    !row ||
    typeof row.payload !== 'string' ||
    typeof row.entry_id !== 'string'
  )
    return undefined;
  const d: ConversationActionRecoveryStage = JSON.parse(row.payload);
  if (
    stableJson(d) !== row.payload ||
    d.version !== 1 ||
    d.manifest.requestId !== requestId ||
    row.epoch !== d.epoch ||
    !isDifferentConversationProcess(d.ownerProcessId, process) ||
    !(await actionRecoveryStageMatches(sql, d, true))
  )
    return undefined;
  if (
    (
      await sql.execute(
        'SELECT request_id FROM conversation_action_recovery_claims WHERE request_id = ?',
        [requestId],
      )
    ).rows.length
  )
    return undefined;
  const receipt = (
    await sql.execute(
      `SELECT h.entry_id, h.source_request_id, a.identity_json FROM conversation_history_receipts h
     JOIN conversation_action_receipts a ON a.request_id = h.request_id AND a.session_id = h.session_id
     WHERE h.request_id = ? AND h.session_id = ?`,
      [requestId, d.manifest.sessionId],
    )
  ).rows[0];
  if (
    receipt?.entry_id !== row.entry_id ||
    receipt.source_request_id !== d.sourceRequestId ||
    receipt.identity_json !==
      JSON.stringify([
        d.manifest.operationRunId,
        d.operationKey,
        d.manifest.sessionVersion,
        d.sourceRequestId,
      ])
  )
    return undefined;
  const original = JSON.parse(d.preparedInput);
  const userMessage = original.researchInput?.userMessage;
  if (typeof userMessage !== 'string') return undefined;
  const entry = await readManualHistoryEntry(sql, row.entry_id);
  if (
    !entry ||
    entry.details !== (conversationHistoryIntent(userMessage) ?? userMessage)
  )
    return undefined;
  if (
    (
      await sql.execute(
        'SELECT id FROM manual_history_entries WHERE supersedes_id = ? LIMIT 1',
        [row.entry_id],
      )
    ).rows.length
  )
    return undefined;
  return { stage: d, entryId: row.entry_id };
}
