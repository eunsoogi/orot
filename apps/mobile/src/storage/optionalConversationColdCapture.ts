import type { SqlDatabase } from '@orot/storage';
import type {
  ConversationColdReconstruction,
  ConversationContinuationCapture,
} from './conversationContinuationCapture';
import type { ConversationContinuationIdentity } from './conversationWorkflowContinuationIdentity';
import { setupConversationColdResume } from './conversationColdResumeSchema';
import { saveConversationColdBoundary } from './saveConversationColdBoundary';

/** Only committed call identities from this exact retained request can restore native-tool scope. */
export async function readConversationColdCallIds(
  database: SqlDatabase,
  identity: ConversationContinuationIdentity,
  operationRunId: string,
): Promise<readonly string[]> {
  const result = await database.execute(
    `SELECT e.call_id FROM conversation_tool_events e
     JOIN conversation_requests r ON r.id = e.message_id AND r.session_id = e.session_id
     JOIN conversation_artifact_sessions s ON s.id = r.session_id AND s.version = r.session_version
     JOIN conversation_artifact_generation g ON g.singleton = 1 AND g.generation = s.generation
     WHERE r.id = ? AND r.session_id = ? AND r.session_version = ?
     AND s.hidden = 0 AND r.status IN ('active', 'interrupted') AND e.run_id = ?
     ORDER BY e.call_id`,
    [
      identity.requestId,
      identity.sessionId,
      identity.sessionVersion,
      operationRunId,
    ],
  );
  return result.rows.map(row => {
    if (typeof row.call_id !== 'string' || !row.call_id)
      throw new Error('Invalid protected tool identity.');
    return row.call_id;
  });
}

/** Cold recovery is optional: unsupported snapshots must not destroy live Continue.
 * Clear old private state first. A storage failure that cannot guarantee removal still propagates.
 */
export function createOptionalConversationColdCapture(
  database: SqlDatabase,
  identity: ConversationContinuationIdentity,
  reconstruct: ConversationColdReconstruction,
): ConversationContinuationCapture {
  const clear = () =>
    database.execute(
      'DELETE FROM conversation_cold_resumes WHERE request_id = ?',
      [identity.requestId],
    );
  const save = saveConversationColdBoundary(database, identity, async input => {
    if (!input.evidenceBatches)
      throw new Error('Live evidence snapshot unavailable.');
    const knownCallIds = await readConversationColdCallIds(
      database,
      identity,
      input.options.execution.operationRunId,
    );
    return reconstruct({ ...input, knownCallIds });
  });
  return async input => {
    await setupConversationColdResume(database);
    await clear();
    try {
      await save(input);
    } catch {
      // Never fall back to an older descriptor or advertise cold availability.
      await clear();
    }
  };
}
