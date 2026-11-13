import { STORAGE_TABLES, type SqlExecutor } from '@orot/storage';

/** Only named, local input domains are eligible for an interrupted preview. */
export const CONVERSATION_PREVIEW_SOURCE_TABLES = [
  ...Object.values(STORAGE_TABLES).map(value => value.table),
  'manual_history_entries',
  'agent_memory_records',
  'symptom_summary_runs',
  'transcript_artifact_staleness',
  'source_deletion_tombstones',
  'agent_memory_removed_sources',
  'legacy_symptom_deleted',
] as const;

// These domains cannot be inputs to an admitted preview. Remove older broad fences
// so another conversation's activity does not erase an unrelated local preview.
const NON_PREVIEW_TABLES = [
  'conversation_artifacts',
  'conversation_tool_events',
  'conversation_task_cards',
  'conversation_invalid_parents',
  'conversation_request_sources',
  'conversation_request_removed_sources',
  'research_artifacts',
];

/** Source changes remove previews in the same transaction; request epochs reject late writers. */
export async function setupConversationPreviewSchema(tx: SqlExecutor) {
  for (const table of NON_PREVIEW_TABLES)
    for (const event of ['insert', 'update', 'delete'])
      await tx.execute(
        `DROP TRIGGER IF EXISTS conversation_preview_${table}_${event}`,
      );
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS conversation_request_previews (request_id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL, session_version INTEGER NOT NULL, boundary INTEGER NOT NULL, template_json TEXT NOT NULL, schema_snapshot TEXT NOT NULL, body TEXT NOT NULL)',
  );
  // A validated answer supersedes only its own raw preview, including partial answers.
  await tx.execute(
    'CREATE TRIGGER IF NOT EXISTS conversation_preview_answer_saved AFTER INSERT ON conversation_artifacts BEGIN DELETE FROM conversation_request_previews WHERE request_id = NEW.id AND session_id = NEW.session_id; END',
  );
  await tx.execute(
    'CREATE TRIGGER IF NOT EXISTS conversation_preview_answer_updated AFTER UPDATE ON conversation_artifacts BEGIN DELETE FROM conversation_request_previews WHERE request_id = NEW.id AND session_id = NEW.session_id; END',
  );
  const columns = await tx.execute('PRAGMA table_info(conversation_requests)');
  if (!columns.rows.some(row => row.name === 'preview_boundary'))
    await tx.execute(
      'ALTER TABLE conversation_requests ADD COLUMN preview_boundary INTEGER NOT NULL DEFAULT 0',
    );
  await tx.execute(
    'CREATE TRIGGER IF NOT EXISTS conversation_preview_request_removed AFTER DELETE ON conversation_requests BEGIN DELETE FROM conversation_request_previews WHERE request_id = OLD.id; END',
  );
  await tx.execute(
    'DROP TRIGGER IF EXISTS conversation_preview_request_changed',
  );
  await tx.execute(
    "CREATE TRIGGER conversation_preview_request_changed AFTER UPDATE ON conversation_requests WHEN NEW.status IN ('cancelled', 'completed') OR OLD.session_version IS NOT NEW.session_version OR OLD.input_json IS NOT NEW.input_json BEGIN DELETE FROM conversation_request_previews WHERE request_id = OLD.id; END",
  );
  const existing = await tx.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table'",
  );
  const names = new Set(existing.rows.map(row => row.name));
  for (const table of new Set(CONVERSATION_PREVIEW_SOURCE_TABLES)) {
    if (!names.has(table)) continue;
    for (const event of ['INSERT', 'UPDATE', 'DELETE'] as const) {
      await tx.execute(
        `DROP TRIGGER IF EXISTS conversation_preview_${table}_${event.toLowerCase()}`,
      );
      await tx.execute(
        `CREATE TRIGGER conversation_preview_${table}_${event.toLowerCase()} AFTER ${event} ON ${table} BEGIN DELETE FROM conversation_request_previews; END`,
      );
    }
  }
}

/** A missing domain or schema change makes a stored preview ineligible until recaptured. */
export async function conversationPreviewSchemaSnapshot(
  tx: SqlExecutor,
): Promise<string | null> {
  const result = await tx.execute(
    "SELECT type, name, sql FROM sqlite_master WHERE type IN ('table', 'trigger', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name",
  );
  const tables = new Set(
    result.rows.filter(row => row.type === 'table').map(row => row.name),
  );
  const triggers = new Set(
    result.rows.filter(row => row.type === 'trigger').map(row => row.name),
  );
  if (
    CONVERSATION_PREVIEW_SOURCE_TABLES.some(
      table =>
        !tables.has(table) ||
        ['insert', 'update', 'delete'].some(
          event => !triggers.has(`conversation_preview_${table}_${event}`),
        ),
    )
  )
    return null;
  return JSON.stringify(result.rows);
}
