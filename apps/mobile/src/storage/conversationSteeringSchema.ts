import type { SqlDatabase } from '@orot/storage';

/** Steering text and bound model payloads share the protected journal's deletion fences. */
export async function setupConversationSteering(database: SqlDatabase) {
  await database.transaction(async sql => {
    await sql.execute(`CREATE TABLE IF NOT EXISTS conversation_steering (
      request_id TEXT NOT NULL, run_id TEXT NOT NULL, id TEXT NOT NULL,
      sequence INTEGER NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL,
      PRIMARY KEY (request_id, run_id, id), UNIQUE(request_id, run_id, sequence))`);
    await sql.execute(`CREATE TABLE IF NOT EXISTS conversation_steering_bindings (
      request_id TEXT NOT NULL, run_id TEXT NOT NULL, operation_id TEXT NOT NULL,
      base TEXT NOT NULL, payload TEXT NOT NULL, through_sequence INTEGER NOT NULL,
      PRIMARY KEY(request_id, run_id, operation_id))`);
    await sql.execute(`CREATE TABLE IF NOT EXISTS conversation_live_steering (
      request_id TEXT NOT NULL, run_id TEXT NOT NULL, id TEXT NOT NULL,
      operation_id TEXT NOT NULL, status TEXT NOT NULL,
      PRIMARY KEY(request_id, run_id, id))`);
    // Additive receipt metadata leaves old rows and positional legacy inserts intact.
    // Old receipts have no known observation time and must never be backfilled with now.
    await sql.execute(`CREATE TABLE IF NOT EXISTS conversation_steering_receipt_times (
      request_id TEXT NOT NULL, run_id TEXT NOT NULL, id TEXT NOT NULL,
      submitted_at TEXT, sent_at TEXT, read_at TEXT, PRIMARY KEY(request_id, run_id, id))`);
    await sql.execute(`CREATE TRIGGER IF NOT EXISTS steering_receipt_times_removed
      AFTER DELETE ON conversation_steering BEGIN
      DELETE FROM conversation_steering_receipt_times
      WHERE request_id=OLD.request_id AND run_id=OLD.run_id AND id=OLD.id; END`);
    await sql.execute(`CREATE TRIGGER IF NOT EXISTS live_steering_removed
      AFTER DELETE ON conversation_steering BEGIN
      DELETE FROM conversation_live_steering WHERE request_id=OLD.request_id AND run_id=OLD.run_id AND id=OLD.id; END`);
    for (const [table, key] of [
      ['conversation_requests', 'id'],
      ['conversation_workflow_resumes', 'request_id'],
    ])
      await sql.execute(`CREATE TRIGGER IF NOT EXISTS steering_${table}_removed
      AFTER DELETE ON ${table} BEGIN
      DELETE FROM conversation_steering WHERE request_id = OLD.${key};
      DELETE FROM conversation_steering_bindings WHERE request_id = OLD.${key}; END`);
    await sql.execute(`CREATE TRIGGER IF NOT EXISTS steering_epoch_changed
      AFTER UPDATE ON conversation_journal_epoch BEGIN
      DELETE FROM conversation_steering; DELETE FROM conversation_steering_bindings; END`);
    await sql.execute(`DROP TRIGGER IF EXISTS steering_request_completed`);
    await sql.execute(`CREATE TRIGGER IF NOT EXISTS steering_request_completed
      AFTER UPDATE OF status ON conversation_requests WHEN NEW.status = 'completed' BEGIN
      UPDATE conversation_steering SET status = 'not_applied'
      WHERE request_id = NEW.id AND status NOT IN ('applied', 'delivery_pending'); END`);
  });
}
