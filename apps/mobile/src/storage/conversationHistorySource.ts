import type { SqlExecutor } from '@orot/storage';
import type { ConversationHistorySave } from './conversationHealthHistory';
import { conversationHistoryIntent } from '../manualHistory/conversationHistoryIntent';

/** Revalidate the exact user-authored source inside the receipt transaction. */
export async function validateConversationHistorySource(
  tx: SqlExecutor,
  input: ConversationHistorySave,
  details: string,
): Promise<void> {
  const source = await tx.execute(
    'SELECT r.question, r.status FROM conversation_requests r ' +
      'JOIN conversation_artifact_sessions s ON s.id = r.session_id ' +
      'WHERE r.id = ? AND r.session_id = ? AND r.session_version = ? ' +
      'AND s.version = r.session_version AND s.hidden = 0',
    [input.requestId, input.sessionId, input.sessionVersion],
  );
  const row = source.rows[0];
  if (!row || row.question !== input.question || row.status !== 'active')
    throw new Error('History source request is no longer active.');
  if (input.approvedSource) {
    const sourceId = input.approvedSource.requestId;
    let sourceQuestion = input.question;
    if (sourceId !== input.requestId) {
      const prior = await tx.execute(
        'SELECT result_json FROM conversation_artifacts WHERE id = ? AND session_id = ?',
        [sourceId, input.sessionId],
      );
      if (typeof prior.rows[0]?.result_json !== 'string')
        throw new Error('The selected source was removed.');
      const artifact = JSON.parse(prior.rows[0].result_json);
      sourceQuestion = artifact.question;
    }
    if (
      typeof sourceQuestion !== 'string' ||
      (sourceQuestion !== details &&
        conversationHistoryIntent(sourceQuestion) !== details)
    )
      throw new Error('The selected user source changed.');
  }
}
