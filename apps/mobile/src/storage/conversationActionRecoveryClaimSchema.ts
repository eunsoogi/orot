import type { SqlExecutor } from '@orot/storage';

/** Independent single-use claims never alter the normal safe-boundary eligibility rules. */
export async function setupConversationActionRecoveryClaims(sql: SqlExecutor) {
  await sql.execute(`CREATE TABLE IF NOT EXISTS conversation_action_recovery_claims (
    request_id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL,
    owner_process_id TEXT NOT NULL, attempt INTEGER NOT NULL)`);
  await sql.execute(`CREATE TRIGGER IF NOT EXISTS action_recovery_claim_removed
    AFTER DELETE ON conversation_action_recovery BEGIN
    DELETE FROM conversation_action_recovery_claims WHERE request_id = OLD.request_id; END`);
}
