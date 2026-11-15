import { STORAGE_TABLES, type SqlDatabase } from '@orot/storage';

/** Private operation payloads remain in the encrypted DB and are never graph channel values. */
export async function setupConversationOperationJournal(database: SqlDatabase) {
  await database.transaction(async sql => {
    await sql.execute(`CREATE TABLE IF NOT EXISTS conversation_operation_journal (
      request_id TEXT NOT NULL, run_id TEXT NOT NULL, operation_id TEXT NOT NULL,
      input TEXT, refs TEXT, status TEXT NOT NULL, revision INTEGER NOT NULL,
      claim TEXT, result TEXT, PRIMARY KEY(request_id, run_id, operation_id))`);
    await sql.execute(
      'CREATE TABLE IF NOT EXISTS conversation_journal_epoch (id INTEGER PRIMARY KEY, value INTEGER NOT NULL)',
    );
    await sql.execute(
      'INSERT OR IGNORE INTO conversation_journal_epoch VALUES (1, 0)',
    );
    for (const [table, key] of [
      ['conversation_workflow_resumes', 'request_id'],
      ['conversation_requests', 'id'],
    ])
      await sql.execute(`CREATE TRIGGER IF NOT EXISTS journal_${table}_removed
      AFTER DELETE ON ${table} BEGIN DELETE FROM conversation_operation_journal
      WHERE request_id = OLD.${key}; END`);
    const available = new Set(
      (
        await sql.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
      ).rows.map(row => row.name),
    );
    const tables = new Set([
      ...Object.values(STORAGE_TABLES).map(value => value.table),
      'agent_memory_records',
      'manual_history_entries',
      'symptom_summary_runs',
      'conversation_artifacts',
      'research_artifacts',
      'transcript_artifact_staleness',
      'research_artifact_invalid',
      'conversation_invalid_parents',
      'conversation_invalid_summaries',
      'source_deletion_tombstones',
      'agent_memory_removed_sources',
    ]);
    // Conservative invalidation avoids resolving potentially deleted private sources.
    // Unrelated edits may block resume, but never turn uncertain work into a new call.
    for (const table of tables) {
      if (!available.has(table)) continue;
      const events =
        table.includes('removed') ||
        table.includes('tombstones') ||
        table.includes('staleness') ||
        table.includes('invalid')
          ? ['INSERT', 'UPDATE', 'DELETE']
          : ['UPDATE', 'DELETE'];
      for (const event of events)
        await sql.execute(`CREATE TRIGGER IF NOT EXISTS journal_source_${table}_${event}
        AFTER ${event} ON ${table} BEGIN
        UPDATE conversation_journal_epoch SET value = value + 1 WHERE id = 1;
        UPDATE conversation_operation_journal
        SET status = 'invalidated', input = NULL, refs = NULL, result = NULL, claim = NULL; END`);
    }
  });
}
