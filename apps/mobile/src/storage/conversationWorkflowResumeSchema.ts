import type { SqlExecutor } from '@orot/storage';

/** Uses the protected conversation database; deletion removes private manifests atomically. */
export async function setupConversationWorkflowResume(sql: SqlExecutor) {
  await sql.execute(`CREATE TABLE IF NOT EXISTS conversation_workflow_resumes (
    request_id TEXT PRIMARY KEY NOT NULL, manifest TEXT NOT NULL,
    checkpoint_id TEXT, boundary TEXT, attempt INTEGER NOT NULL DEFAULT 0,
    claimed INTEGER NOT NULL DEFAULT 0)`);
  await sql.execute(`CREATE TRIGGER IF NOT EXISTS conversation_resume_request_removed
    AFTER DELETE ON conversation_requests BEGIN
    DELETE FROM conversation_workflow_resumes WHERE request_id = OLD.id; END`);
  // Explicit Stop preserves the question but irrevocably retires this graph owner.
  await sql.execute(`CREATE TRIGGER IF NOT EXISTS conversation_resume_request_stopped
    AFTER UPDATE OF interruption_reason ON conversation_requests
    WHEN NEW.interruption_reason = 'user-stopped' BEGIN
    DELETE FROM conversation_workflow_resumes WHERE request_id = NEW.id; END`);
  // Invalidation cannot leave resumable private inputs behind.
  await sql.execute(`CREATE TRIGGER IF NOT EXISTS conversation_resume_request_cancelled
    AFTER UPDATE OF status ON conversation_requests WHEN NEW.status = 'cancelled' BEGIN
    DELETE FROM conversation_workflow_resumes WHERE request_id = NEW.id; END`);
}
