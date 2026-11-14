import type { SqlDatabase } from '@orot/storage';

/** Conversation graph writes must not resurrect deleted work; private metadata follows request removal. */
export async function setupConversationWorkflowCheckpointGuards(
  database: SqlDatabase,
) {
  await database.transaction(async sql => {
    for (const table of [
      'langgraph_checkpoints',
      'langgraph_checkpoint_writes',
    ]) {
      await sql.execute(`CREATE TRIGGER IF NOT EXISTS conversation_${table}_live
        BEFORE INSERT ON ${table} WHEN NEW.thread_id GLOB 'conversation-resume:*' BEGIN
        SELECT CASE WHEN NOT EXISTS (
          SELECT 1 FROM conversation_workflow_resumes w
          JOIN conversation_requests r ON r.id = w.request_id
          JOIN conversation_artifact_sessions s ON s.id = r.session_id
          JOIN conversation_artifact_generation g ON g.singleton = 1
          WHERE json_extract(w.manifest, '$.threadId') = NEW.thread_id
          AND r.status = 'active' AND s.hidden = 0 AND s.version = r.session_version
          AND s.generation = g.generation)
        THEN RAISE(ABORT, 'Conversation workflow is unavailable') END; END`);
    }
    await sql.execute(`CREATE TRIGGER IF NOT EXISTS conversation_workflow_removed
      AFTER DELETE ON conversation_workflow_resumes BEGIN
      DELETE FROM langgraph_checkpoint_writes WHERE thread_id = json_extract(OLD.manifest, '$.threadId');
      DELETE FROM langgraph_checkpoints WHERE thread_id = json_extract(OLD.manifest, '$.threadId'); END`);
  });
}
