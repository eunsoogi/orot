import {
  autoLocalConversationMemoryIdPrefix,
  type SqlExecutor,
} from '@orot/storage';

/** A note-only deletion leaves the opaque write fence; deletion of the
 * authoritative turn or permanent session deletion removes its whole lineage. */
export async function setupOrdinaryConversationMemoryNotes(tx: SqlExecutor) {
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS ordinary_conversation_memory_notes (' +
      'request_id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL, ' +
      'entry_id TEXT NOT NULL UNIQUE)',
  );
  await tx.execute(
    'CREATE INDEX IF NOT EXISTS ordinary_conversation_memory_notes_session ' +
      'ON ordinary_conversation_memory_notes (session_id)',
  );

  for (const [suffix, table, exact] of [
    [
      'source',
      'conversation_artifacts',
      'request_id = OLD.id AND session_id = OLD.session_id',
    ],
    ['session', 'conversation_artifact_sessions', 'session_id = OLD.id'],
  ] as const) {
    // Only the typed auto note lineage may be removed, never another manual or
    // explicit note even if a corrupt receipt names an unrelated entry.
    await tx.execute(`CREATE TRIGGER IF NOT EXISTS ordinary_conversation_memory_${suffix}_removed
      AFTER DELETE ON ${table} BEGIN
      DELETE FROM manual_history_entries WHERE id IN (
        WITH RECURSIVE related(id) AS (
          SELECT entry_id FROM ordinary_conversation_memory_notes
          WHERE ${exact} AND entry_id = '${autoLocalConversationMemoryIdPrefix}' || request_id
          UNION
          SELECT h.id FROM manual_history_entries h JOIN related r ON h.supersedes_id = r.id
          WHERE substr(h.id, 1, ${autoLocalConversationMemoryIdPrefix.length}) = '${autoLocalConversationMemoryIdPrefix}'
        ) SELECT id FROM related
      );
      DELETE FROM ordinary_conversation_memory_notes WHERE ${exact};
      END`);
  }
}
