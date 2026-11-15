import type { SqlDatabase } from '@orot/storage';
import { setupConversationOperationJournal } from './conversationOperationJournalSchema';

/** Private reconstruction data lives only in the protected DB and shares journal invalidation. */
export async function setupConversationColdResume(database: SqlDatabase) {
  await setupConversationOperationJournal(database);
  await database.transaction(async sql => {
    await sql.execute(`CREATE TABLE IF NOT EXISTS conversation_cold_resumes (
      request_id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL,
      checkpoint_binding TEXT NOT NULL, epoch INTEGER NOT NULL)`);
    for (const [table, key] of [
      ['conversation_workflow_resumes', 'request_id'],
      ['conversation_requests', 'id'],
    ])
      await sql.execute(`CREATE TRIGGER IF NOT EXISTS cold_${table}_removed
      AFTER DELETE ON ${table} BEGIN DELETE FROM conversation_cold_resumes
      WHERE request_id = OLD.${key}; END`);
    // Source triggers advance this epoch even when no current run holds a journal row.
    await sql.execute(`CREATE TRIGGER IF NOT EXISTS cold_resume_epoch_changed
      AFTER UPDATE OF value ON conversation_journal_epoch BEGIN
      DELETE FROM conversation_cold_resumes; END`);
    await sql.execute(`CREATE TRIGGER IF NOT EXISTS cold_resume_request_finished
      AFTER UPDATE OF status ON conversation_requests
      WHEN NEW.status NOT IN ('active', 'interrupted') BEGIN
      DELETE FROM conversation_cold_resumes WHERE request_id = NEW.id; END`);
  });
}
