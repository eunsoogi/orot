import {
  actionRecoverySourceMatches,
  recoverySaveInput,
} from './actionRecoverySource';
import { additionalHistoryOperation } from './conversationHistoryOperationReceipt';
import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import { stableJson } from '../aiFeatures/integration/evidenceUtils';
import { coldCheckpointBinding } from './conversationColdResumeBinding';
import type { ConversationResumeManifest } from './conversationWorkflowResumeStorage';
import { setupConversationActionRecovery } from './conversationActionRecoverySchema';

/** A prebuilt snapshot from the durable pre-action boundary, not a permission grant.
 * ownerProcessId is supplied by the trusted lifetime owner; this module does not
 * interpret a different value as evidence that the previous owner has terminated.
 */
export interface ConversationActionRecoveryStage {
  version: 1;
  manifest: ConversationResumeManifest;
  ownerProcessId: string;
  attempt: number;
  claimed: 0 | 1;
  epoch: number;
  operationKey: string;
  sourceRequestId: string;
  checkpointId: string;
  checkpointBinding: string;
  preparedInput: string;
  preparedReferences: string;
  preparedRevision: number;
  submittedInput: string | null;
  reconstruction: import('@orot/model-runtime').JsonObject;
}

/** Checks owner and exact prepared context without changing active execution. */
export async function actionRecoveryStageMatches(
  sql: SqlExecutor,
  d: ConversationActionRecoveryStage,
  allowInterrupted = false,
): Promise<boolean> {
  const m = d.manifest;
  const owner = (
    await sql.execute(
      `SELECT r.question, r.input_json, w.manifest, w.attempt, w.claimed, e.value AS epoch
    FROM conversation_requests r JOIN conversation_workflow_resumes w ON w.request_id = r.id
    JOIN conversation_artifact_sessions s ON s.id = r.session_id
    JOIN conversation_artifact_generation g ON g.singleton = 1
    JOIN conversation_journal_epoch e ON e.id = 1
    WHERE r.id = ? AND r.session_id = ? AND r.session_version = ?
    AND (r.status = 'active' OR (? = 1 AND r.status = 'interrupted'))
    AND COALESCE(r.interruption_reason, '') != 'user-stopped' AND s.hidden = 0 AND s.version = r.session_version
    AND s.generation = g.generation`,
      [m.requestId, m.sessionId, m.sessionVersion, allowInterrupted ? 1 : 0],
    )
  ).rows[0];
  if (
    !owner ||
    owner.manifest !== stableJson(m) ||
    owner.attempt !== d.attempt ||
    owner.claimed !== d.claimed ||
    owner.epoch !== d.epoch ||
    (owner.input_json ?? null) !== d.submittedInput
  )
    return false;
  if (!(await actionRecoverySourceMatches(sql, d, String(owner.question))))
    return false;
  const uncertain = await sql.execute(
    "SELECT operation_id FROM conversation_operation_journal WHERE request_id = ? AND run_id = ? AND status IN ('pending', 'invalidated') LIMIT 1",
    [m.requestId, m.operationRunId],
  );
  if (uncertain.rows.length) return false;
  const checkpoint = await coldCheckpointBinding(sql, m);
  if (
    checkpoint?.checkpointId !== d.checkpointId ||
    checkpoint.bytes !== d.checkpointBinding
  )
    return false;
  const row = (
    await sql.execute(
      `SELECT input, refs, revision, status, purpose FROM conversation_operation_journal
     WHERE request_id = ? AND run_id = ? AND operation_id = ?`,
      [m.requestId, m.operationRunId, `${d.operationKey}:context`],
    )
  ).rows[0];
  return (
    !!row &&
    row.status === 'ready' &&
    row.purpose == null &&
    row.input === d.preparedInput &&
    row.refs === d.preparedReferences &&
    row.revision === d.preparedRevision
  );
}

export async function stageConversationActionRecovery(
  database: SqlDatabase,
  supplied: ConversationActionRecoveryStage,
  signal: AbortSignal,
): Promise<void> {
  const payload = stableJson(supplied);
  const d: ConversationActionRecoveryStage = JSON.parse(payload);
  if (
    payload.length > 2_000_000 ||
    d.version !== 1 ||
    !d.ownerProcessId ||
    d.ownerProcessId.length > 200 ||
    !d.sourceRequestId ||
    !/^tool-[1-9]\d*$/.test(d.operationKey) ||
    !d.checkpointId ||
    !Number.isSafeInteger(d.attempt) ||
    d.attempt < 0 ||
    !Number.isSafeInteger(d.epoch) ||
    d.epoch < 0 ||
    !Number.isSafeInteger(d.preparedRevision) ||
    d.preparedRevision < 0 ||
    ![0, 1].includes(d.claimed) ||
    (d.submittedInput !== null && typeof d.submittedInput !== 'string')
  )
    throw new Error('Invalid action recovery stage.');
  const original = JSON.parse(d.preparedInput);
  if (
    original.binding?.phase !== 'local_action' ||
    original.binding?.selectedToolId !== 'save-past-health-history' ||
    original.binding?.execution?.operationRunId !== d.manifest.operationRunId ||
    `tool-${original.binding?.toolCalls}` !== d.operationKey ||
    stableJson(original.binding.evidenceReferences) !== d.preparedReferences
  )
    throw new Error('Action recovery input binding changed.');
  await database.transaction(async sql => {
    await setupConversationActionRecovery(sql);
    if (signal.aborted || !(await actionRecoveryStageMatches(sql, d)))
      throw new Error('Action recovery stage is no longer current.');
    const historyExists = await sql.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'conversation_history_receipts'",
    );
    if (
      historyExists.rows.length &&
      (
        await sql.execute(
          'SELECT request_id FROM conversation_history_receipts WHERE request_id = ?',
          [d.manifest.requestId],
        )
      ).rows.length
    ) {
      const request = (
        await sql.execute(
          'SELECT question FROM conversation_requests WHERE id=?',
          [d.manifest.requestId],
        )
      ).rows[0];
      const additional = await additionalHistoryOperation(
        sql,
        recoverySaveInput(d, String(request?.question)),
      );
      if (!additional || additional.existing)
        throw new Error('Cannot stage recovery after an existing write.');
    }
    const old = (
      await sql.execute(
        'SELECT payload FROM conversation_action_recovery WHERE request_id = ?',
        [d.manifest.requestId],
      )
    ).rows[0];
    if (old && old.payload !== payload)
      throw new Error('Action recovery stage is immutable.');
    await sql.execute(
      "INSERT OR IGNORE INTO conversation_action_recovery VALUES (?, ?, 'staged', NULL, ?)",
      [d.manifest.requestId, payload, d.epoch],
    );
    if (signal.aborted) throw new Error('Action recovery staging cancelled.');
  });
}
