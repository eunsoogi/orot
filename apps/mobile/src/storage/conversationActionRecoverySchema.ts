import type { SqlExecutor } from '@orot/storage';

/** Staging grants no execution or takeover. Private snapshots share source invalidation. */
export async function setupConversationActionRecovery(sql: SqlExecutor) {
  await sql.execute(`CREATE TABLE IF NOT EXISTS conversation_action_recovery (
    request_id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('staged', 'committed')),
    entry_id TEXT, epoch INTEGER NOT NULL)`);
  for (const [table, key] of [
    ['conversation_workflow_resumes', 'request_id'],
    ['conversation_requests', 'id'],
  ])
    await sql.execute(`CREATE TRIGGER IF NOT EXISTS action_recovery_${table}_removed
      AFTER DELETE ON ${table} BEGIN DELETE FROM conversation_action_recovery
      WHERE request_id = OLD.${key}; END`);
  await sql.execute(`CREATE TRIGGER IF NOT EXISTS action_recovery_epoch_changed
    AFTER UPDATE OF value ON conversation_journal_epoch BEGIN
    DELETE FROM conversation_action_recovery; END`);
  await sql.execute(`CREATE TRIGGER IF NOT EXISTS action_recovery_request_finished
    AFTER UPDATE OF status ON conversation_requests
    WHEN NEW.status NOT IN ('active', 'interrupted') BEGIN
    DELETE FROM conversation_action_recovery WHERE request_id = NEW.id; END`);
}
