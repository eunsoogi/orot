import type { SqlExecutor } from '@orot/storage';
import { stableJson } from '../aiFeatures/integration/evidenceUtils';
import type { ConversationResumeManifest } from './conversationWorkflowResumeStorage';

/** Include pending writes and exact serialized bytes, not a hash or just a checkpoint ID. */
export async function coldCheckpointBinding(
  sql: SqlExecutor,
  m: ConversationResumeManifest,
) {
  const row = (
    await sql.execute(
      `SELECT checkpoint_id, parent_checkpoint_id,
    checkpoint_type, hex(checkpoint) AS checkpoint, metadata_type, hex(metadata) AS metadata
    FROM langgraph_checkpoints WHERE thread_id = ? AND checkpoint_ns = ''
    ORDER BY checkpoint_id DESC LIMIT 1`,
      [m.threadId],
    )
  ).rows[0];
  if (!row) return undefined;
  const writes = (
    await sql.execute(
      `SELECT task_id, idx, channel, type, hex(value) AS value
    FROM langgraph_checkpoint_writes WHERE thread_id = ? AND checkpoint_ns = ''
    AND checkpoint_id = ? ORDER BY task_id, idx`,
      [m.threadId, row.checkpoint_id],
    )
  ).rows;
  return {
    checkpointId: row.checkpoint_id,
    bytes: stableJson({ row, writes }),
  };
}

/** Same request, visible generation, immutable original input, and no uncertain external intent. */
export async function coldResumeOwner(
  sql: SqlExecutor,
  m: ConversationResumeManifest,
) {
  return (
    await sql.execute(
      `SELECT r.status, r.question, r.input_json,
    w.manifest, w.attempt, w.claimed, w.checkpoint_id, w.boundary,
    e.value AS epoch FROM conversation_requests r
    JOIN conversation_workflow_resumes w ON w.request_id = r.id
    JOIN conversation_artifact_sessions s ON s.id = r.session_id
    JOIN conversation_artifact_generation g ON g.singleton = 1
    JOIN conversation_journal_epoch e ON e.id = 1
    WHERE r.id = ? AND r.session_id = ? AND r.session_version = ?
    AND s.version = r.session_version AND s.hidden = 0 AND s.generation = g.generation
    AND r.status IN ('active', 'interrupted')
    AND NOT EXISTS (SELECT 1 FROM conversation_operation_journal j
      WHERE j.request_id = r.id AND j.run_id = ? AND j.status IN ('pending', 'invalidated'))`,
      [m.requestId, m.sessionId, m.sessionVersion, m.operationRunId],
    )
  ).rows[0];
}
