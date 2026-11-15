import type { SqlDatabase } from '@orot/storage';
import type { ConversationContinuationCapture } from './conversationContinuationCapture';
import type { ConversationContinuationIdentity } from './conversationWorkflowContinuationIdentity';
import { continuationManifest } from './conversationWorkflowContinuationIdentity';
import {
  coldCheckpointBinding,
  coldResumeOwner,
} from './conversationColdResumeBinding';
import { stableJson } from '../aiFeatures/integration/evidenceUtils';

/** A newer durable checkpoint already contains the first result. Retire only its
 * obsolete crash marker before a later action; this grants no recovery or write.
 * Later pending actions remain unsupported rather than borrowing an old receipt.
 */
export async function retireCompletedActionRecovery(
  database: SqlDatabase,
  identity: ConversationContinuationIdentity,
  input: Parameters<ConversationContinuationCapture>[0],
): Promise<void> {
  const signal = input.signal;
  if (!signal || signal.aborted) throw new Error('Action owner cancelled.');
  const manifest = continuationManifest(
    identity,
    `conversation-resume:${identity.requestId}`,
    input.options,
  );
  const binding = await coldCheckpointBinding(database, manifest);
  if (!binding || binding.checkpointId !== input.checkpointId)
    throw new Error('Completed action checkpoint changed.');
  await database.transaction(async tx => {
    const exists = await tx.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_action_recovery'",
    );
    if (!exists.rows.length) return;
    const row = (
      await tx.execute(
        'SELECT payload, status, entry_id FROM conversation_action_recovery WHERE request_id=?',
        [identity.requestId],
      )
    ).rows[0];
    if (!row) return;
    const stage = JSON.parse(String(row.payload));
    const owner = await coldResumeOwner(tx, manifest);
    const current = await coldCheckpointBinding(tx, manifest);
    const receipt = input.checkpoint.committedActionReceipts?.find(
      r => r.operationKey === stage.operationKey,
    );
    if (
      signal.aborted ||
      !owner ||
      owner.status !== 'active' ||
      owner.attempt !== input.attempt ||
      owner.manifest !== stableJson(manifest) ||
      current?.bytes !== binding.bytes ||
      row.status !== 'committed' ||
      stableJson(stage.manifest) !== stableJson(manifest) ||
      !receipt ||
      receipt.operationRunId !== manifest.operationRunId ||
      receipt.toolId !== 'save-past-health-history' ||
      stage.checkpointId === input.checkpointId ||
      receipt.operationKey === input.checkpoint.pendingOperation?.operationKey
    )
      throw new Error(
        'Completed action marker is not owned by this checkpoint.',
      );
    const saved = (
      await tx.execute(
        'SELECT entry_id FROM conversation_history_receipts WHERE request_id=? AND session_id=?',
        [identity.requestId, identity.sessionId],
      )
    ).rows[0];
    if (saved?.entry_id !== row.entry_id)
      throw new Error('Completed action receipt changed.');
    await tx.execute(
      'DELETE FROM conversation_action_recovery WHERE request_id=? AND payload=?',
      [identity.requestId, String(row.payload)],
    );
    if (signal.aborted) throw new Error('Action owner cancelled.');
  });
}
