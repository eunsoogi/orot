import {
  autoLocalConversationMemoryIdPrefix,
  readManualHistoryEntry,
  type SqlExecutor,
} from '@orot/storage';
import {
  hasOrdinaryConversationCompletedSource,
  type OrdinaryConversationCompletionIdentity,
} from './ordinaryConversationMemoryCompletion';

/** Suppress only an exact repeat backed by a still-live, uncorrected auto-note
 * in this same session generation. The original remains the only lineage;
 * no alias or replacement receipt is written for the second request. */
export async function hasCurrentOrdinaryMemoryRepeat(
  tx: SqlExecutor,
  source: OrdinaryConversationCompletionIdentity,
  authored: string,
) {
  const rows = await tx.execute(
    `SELECT prior.id, prior.created_at, note.entry_id
     FROM ordinary_conversation_memory_notes note
     JOIN conversation_requests prior
       ON prior.id = note.request_id AND prior.session_id = note.session_id
     JOIN manual_history_entries entry ON entry.id = note.entry_id
     WHERE note.session_id = ? AND prior.session_version = ?
       AND prior.id <> ? AND prior.question = ? COLLATE BINARY
       AND note.entry_id = ? || note.request_id
       AND entry.entry_kind = 'note' AND entry.supersedes_id IS NULL
       AND json_extract(entry.payload_json, '$.details') = ? COLLATE BINARY
       AND NOT EXISTS (
         SELECT 1 FROM manual_history_entries successor WHERE successor.supersedes_id = entry.id
       )
     ORDER BY prior.created_at DESC, prior.id DESC LIMIT 1`,
    [
      source.sessionId,
      source.sessionVersion,
      source.requestId,
      source.question,
      autoLocalConversationMemoryIdPrefix,
      authored,
    ],
  );
  const prior = rows.rows[0];
  if (
    typeof prior?.id !== 'string' ||
    typeof prior.created_at !== 'string' ||
    typeof prior.entry_id !== 'string'
  )
    return false;
  const entry = await readManualHistoryEntry(tx, prior.entry_id);
  return (
    entry?.kind === 'note' &&
    entry.details === authored &&
    entry.recordedAt === prior.created_at &&
    (await hasOrdinaryConversationCompletedSource(tx, {
      ...source,
      requestId: prior.id,
      createdAt: prior.created_at,
    }))
  );
}
