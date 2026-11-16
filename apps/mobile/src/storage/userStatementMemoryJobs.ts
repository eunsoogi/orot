import type { SqlExecutor } from '@orot/storage';
import type { ConversationArtifact } from './conversationArtifactTypes';
import { conversationStatementMemory } from '../memory/userStatementMemory';

/** Queue only source identities in the answer's own transaction, not a second text copy. */
export async function enqueueStatementMemory(
  sql: SqlExecutor,
  value: ConversationArtifact,
) {
  if (!conversationStatementMemory(value)) return;
  await ensureStatementMemoryJobs(sql);
  await sql.execute(
    "INSERT OR IGNORE INTO user_statement_memory_jobs (source_kind, source_id) VALUES ('conversation_user_statement', ?)",
    [value.id],
  );
}
export async function ensureStatementMemoryJobs(sql: SqlExecutor) {
  await sql.execute(
    'CREATE TABLE IF NOT EXISTS user_statement_memory_jobs (source_kind TEXT NOT NULL, source_id TEXT NOT NULL, PRIMARY KEY (source_kind, source_id))',
  );
  const tables = new Set(
    (
      await sql.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
    ).rows.map(row => row.name),
  );
  if (tables.has('conversation_artifacts')) {
    await sql.execute(
      "CREATE TRIGGER IF NOT EXISTS statement_memory_source_removed AFTER DELETE ON conversation_artifacts BEGIN DELETE FROM user_statement_memory_jobs WHERE source_kind = 'conversation_user_statement' AND source_id = OLD.id; END",
    );
    if (tables.has('conversation_artifact_generation'))
      await sql.execute(
        'CREATE TRIGGER IF NOT EXISTS statement_memory_clear AFTER UPDATE OF generation ON conversation_artifact_generation BEGIN DELETE FROM user_statement_memory_jobs; END',
      );
  }
  if (tables.has('manual_history_entries'))
    await sql.execute(
      "CREATE TRIGGER IF NOT EXISTS statement_memory_history_removed AFTER DELETE ON manual_history_entries BEGIN DELETE FROM user_statement_memory_jobs WHERE source_kind = 'manual_history' AND source_id = OLD.id; END",
    );
}

export async function enqueueManualHistoryMemory(sql: SqlExecutor, id: string) {
  await ensureStatementMemoryJobs(sql);
  await sql.execute(
    "INSERT OR IGNORE INTO user_statement_memory_jobs (source_kind, source_id) VALUES ('manual_history', ?)",
    [id],
  );
}
