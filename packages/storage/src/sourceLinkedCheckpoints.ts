import { RecordIdSchema } from '@orot/domain';
import type { SqlDatabase, SqlExecutor } from './sql';

/** Source-linked graphs may retain review text. Delete their existing checkpoint rows with the source, atomically. */
export async function createSourceLinkedCheckpointIntegrity(database: SqlDatabase): Promise<void> {
  await database.transaction(async (transaction) => {
    await transaction.execute(`CREATE TABLE IF NOT EXISTS langgraph_checkpoint_sources (
      thread_id TEXT PRIMARY KEY NOT NULL,
      source_record_id TEXT NOT NULL
    )`);
    await transaction.execute(`CREATE TRIGGER IF NOT EXISTS source_records_delete_linked_checkpoints
      AFTER DELETE ON source_records BEGIN
      DELETE FROM langgraph_checkpoint_writes WHERE thread_id IN
        (SELECT thread_id FROM langgraph_checkpoint_sources WHERE source_record_id = OLD.id);
      DELETE FROM langgraph_checkpoints WHERE thread_id IN
        (SELECT thread_id FROM langgraph_checkpoint_sources WHERE source_record_id = OLD.id);
      DELETE FROM langgraph_checkpoint_sources WHERE source_record_id = OLD.id;
      DELETE FROM healthkit_sync_checkpoints
        WHERE checkpoint_key GLOB 'encounter-approval:*'
          AND json_extract(CASE WHEN json_valid(value) THEN value ELSE '{}' END, '$.sourceId') = OLD.id;
      END`);
  });
}

/** The existence check and thread binding share each checkpoint write transaction, fencing late work after deletion. */
export async function bindCheckpointSource(
  transaction: SqlExecutor,
  threadId: string,
  sourceRecordId?: string,
): Promise<void> {
  if (sourceRecordId === undefined) return;
  const sourceId = RecordIdSchema.parse(sourceRecordId);
  const present = await transaction.execute('SELECT id FROM source_records WHERE id = ?', [
    sourceId,
  ]);
  if (!present.rows.length) throw new Error('Checkpoint source was removed.');
  await transaction.execute(
    'INSERT OR IGNORE INTO langgraph_checkpoint_sources (thread_id, source_record_id) VALUES (?, ?)',
    [threadId, sourceId],
  );
  const linked = await transaction.execute(
    'SELECT source_record_id FROM langgraph_checkpoint_sources WHERE thread_id = ?',
    [threadId],
  );
  if (linked.rows[0]?.source_record_id !== sourceId)
    throw new Error('Checkpoint thread belongs to another source.');
}
