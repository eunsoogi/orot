import type { SqlExecutor } from '@orot/storage';
import { setupConversationRequestSources } from './conversationRequestSources';

/** Request checkpoints and completion rows share the protected answer database. */
export async function setupConversationRequests(tx: SqlExecutor) {
  await tx.execute(
    "CREATE TABLE IF NOT EXISTS conversation_requests (id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL, session_version INTEGER NOT NULL, question TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('active', 'interrupted', 'cancelled', 'completed'))) ",
  );
  const columns = await tx.execute('PRAGMA table_info(conversation_requests)');
  if (!columns.rows.some(row => row.name === 'input_json'))
    await tx.execute(
      'ALTER TABLE conversation_requests ADD COLUMN input_json TEXT',
    );
  await setupConversationRequestSources(tx);
  // Opaque identity fences outlive session deletion so late work cannot claim a new conversation.
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS conversation_request_identities (id TEXT PRIMARY KEY NOT NULL)',
  );
  await tx.execute(
    'INSERT OR IGNORE INTO conversation_request_identities (id) SELECT id FROM conversation_requests',
  );
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS conversation_completions (request_id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL, message_id TEXT NOT NULL)',
  );
  await tx.execute(
    'CREATE TRIGGER IF NOT EXISTS conversation_requests_session_removed AFTER DELETE ON conversation_artifact_sessions BEGIN DELETE FROM conversation_requests WHERE session_id = OLD.id; DELETE FROM conversation_completions WHERE session_id = OLD.id; END',
  );
  await tx.execute(
    'DROP TRIGGER IF EXISTS conversation_completion_answer_removed',
  );
  await tx.execute(
    'CREATE TRIGGER conversation_completion_answer_removed AFTER DELETE ON conversation_artifacts BEGIN DELETE FROM conversation_completions WHERE message_id = OLD.id; DELETE FROM conversation_requests WHERE id = OLD.id AND session_id = OLD.session_id; END',
  );
}
