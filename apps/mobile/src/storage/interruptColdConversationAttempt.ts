import type { SqlDatabase } from '@orot/storage';
import type { ConversationResumeManifest } from './conversationWorkflowResumeStorage';
import { stableJson } from '../aiFeatures/integration/evidenceUtils';

/** End only this failed claimed attempt, never a later owner or an already committed answer.
 * Do not clear claimed/pending journal entries: uncertain dispatch remains non-replayable.
 */
export async function interruptColdConversationAttempt(
  database: SqlDatabase,
  manifest: ConversationResumeManifest,
  attempt: number,
) {
  if (!Number.isSafeInteger(attempt) || attempt < 1)
    throw new Error('Invalid cold attempt.');
  await database.transaction(async sql => {
    const row = (
      await sql.execute(
        `SELECT r.status, w.manifest, w.attempt FROM conversation_requests r
       JOIN conversation_workflow_resumes w ON w.request_id = r.id
       WHERE r.id = ? AND r.session_id = ? AND r.session_version = ?`,
        [manifest.requestId, manifest.sessionId, manifest.sessionVersion],
      )
    ).rows[0];
    if (
      row?.status !== 'active' ||
      row.manifest !== stableJson(manifest) ||
      row.attempt !== attempt
    )
      return;
    await sql.execute(
      "UPDATE conversation_requests SET status = 'interrupted', interruption_reason = 'process-interrupted' WHERE id = ? AND status = 'active'",
      [manifest.requestId],
    );
    await sql.execute(
      'DELETE FROM conversation_cold_resumes WHERE request_id = ?',
      [manifest.requestId],
    );
  });
}
