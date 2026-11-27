import { STORAGE_TABLES, type SqlDatabase } from '@orot/storage';

/** Private operation payloads remain in the encrypted DB and are never graph channel values. */
export async function setupConversationOperationJournal(database: SqlDatabase) {
  await database.transaction(async sql => {
    // Re-read the current main catalog rather than caching: source tables can
    // open lazily while the provider is running. Existing idempotent DDL still
    // incurs a guarded mutation dispatch on the shared application connection.
    const schema = (
      await sql.execute(
        "SELECT type, name FROM main.sqlite_master WHERE type IN ('table', 'trigger')",
      )
    ).rows;
    const tablesInMain = new Set(
      schema.filter(row => row.type === 'table').map(row => row.name),
    );
    const triggersInMain = new Set(
      schema.filter(row => row.type === 'trigger').map(row => row.name),
    );
    if (!tablesInMain.has('conversation_operation_journal'))
      await sql.execute(`CREATE TABLE IF NOT EXISTS conversation_operation_journal (
      request_id TEXT NOT NULL, run_id TEXT NOT NULL, operation_id TEXT NOT NULL,
      input TEXT, refs TEXT, status TEXT NOT NULL, revision INTEGER NOT NULL,
      claim TEXT, result TEXT, PRIMARY KEY(request_id, run_id, operation_id))`);
    // Existing private journals remain task intents by default. Never infer purpose from prose.
    const columns = (
      await sql.execute('PRAGMA table_info(conversation_operation_journal)')
    ).rows;
    if (!columns.some(column => column.name === 'purpose'))
      await sql.execute(
        'ALTER TABLE conversation_operation_journal ADD COLUMN purpose TEXT',
      );
    if (!tablesInMain.has('conversation_journal_epoch'))
      await sql.execute(
        'CREATE TABLE IF NOT EXISTS conversation_journal_epoch (id INTEGER PRIMARY KEY, value INTEGER NOT NULL)',
      );
    // Do not skip repair of a missing singleton, and never overwrite its epoch.
    if (
      !(
        await sql.execute(
          'SELECT id FROM conversation_journal_epoch WHERE id = 1',
        )
      ).rows.length
    )
      await sql.execute(
        'INSERT OR IGNORE INTO conversation_journal_epoch VALUES (1, 0)',
      );
    for (const [table, key] of [
      ['conversation_workflow_resumes', 'request_id'],
      ['conversation_requests', 'id'],
    ]) {
      if (triggersInMain.has(`journal_${table}_removed`)) continue;
      await sql.execute(`CREATE TRIGGER IF NOT EXISTS journal_${table}_removed
      AFTER DELETE ON ${table} BEGIN DELETE FROM conversation_operation_journal
      WHERE request_id = OLD.${key}; END`);
    }
    const sourceSchema = (
      await sql.execute(
        "SELECT type, name FROM main.sqlite_master WHERE type IN ('table', 'trigger')",
      )
    ).rows;
    const existingSources = new Set(
      sourceSchema.filter(row => row.type === 'table').map(row => row.name),
    );
    const existingSourceTriggers = new Set(
      sourceSchema.filter(row => row.type === 'trigger').map(row => row.name),
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
      if (!existingSources.has(table)) continue;
      const events =
        table.includes('removed') ||
        table.includes('tombstones') ||
        table.includes('staleness') ||
        table.includes('invalid')
          ? ['INSERT', 'UPDATE', 'DELETE']
          : ['UPDATE', 'DELETE'];
      for (const event of events) {
        const trigger = `journal_source_${table}_${event}`;
        if (existingSourceTriggers.has(trigger)) continue;
        await sql.execute(`CREATE TRIGGER IF NOT EXISTS ${trigger}
        AFTER ${event} ON ${table} BEGIN
        UPDATE conversation_journal_epoch SET value = value + 1 WHERE id = 1;
        UPDATE conversation_operation_journal
        SET status = 'invalidated', input = NULL, refs = NULL, result = NULL, claim = NULL; END`);
      }
    }
  });
}
