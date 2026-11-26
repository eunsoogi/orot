import { RecordIdSchema } from '@orot/domain';
import type { SqlDatabase, SqlExecutor } from './sql';

const REMOVAL_MARKERS = ['source_deletion_tombstones', 'agent_memory_removed_sources'] as const;

const approvalKey = "checkpoint_key GLOB 'encounter-approval:*'";
const approvalSource =
  "json_extract(CASE WHEN json_valid(value) THEN value ELSE '{}' END, '$.sourceId')";
const cleanupIndexes = [
  {
    name: 'langgraph_checkpoint_sources_source_record_idx',
    table: 'langgraph_checkpoint_sources',
    definition: '(source_record_id)',
  },
  {
    name: 'healthkit_sync_checkpoints_encounter_source_idx',
    table: 'healthkit_sync_checkpoints',
    definition: `(${approvalSource}) WHERE ${approvalKey}`,
  },
] as const;

async function missingCleanupIndexes(sql: SqlExecutor) {
  const { rows } = await sql.execute(
    'SELECT name, type FROM sqlite_master WHERE name IN (?, ?, ?, ?)',
    cleanupIndexes.flatMap(({ name, table }) => [name, table]),
  );
  if (!rows.some((row) => row.name === cleanupIndexes[0].table && row.type === 'table')) return [];
  return cleanupIndexes.filter(
    ({ name, table }) =>
      rows.some((row) => row.name === table && row.type === 'table') &&
      !rows.some((row) => row.name === name && row.type === 'index'),
  );
}

async function installCleanupIndexes(executor: SqlExecutor) {
  for (const { name, table, definition } of await missingCleanupIndexes(executor))
    await executor.execute(`CREATE INDEX IF NOT EXISTS ${name} ON ${table} ${definition}`);
}

/** Backfill only existing checkpoint schema; ordinary opens do not create it or take a writer. */
export async function ensureSourceLinkedCheckpointCleanupIndexes(database: SqlDatabase) {
  if ((await missingCleanupIndexes(database)).length)
    await database.transaction(installCleanupIndexes);
}

/** These are canonical deletion markers, not a second removal registry. A table may still be lazily unopened. */
async function existingMarkers(sql: SqlExecutor): Promise<string[]> {
  const result = await sql.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (?, ?)",
    [...REMOVAL_MARKERS],
  );
  return REMOVAL_MARKERS.filter((name) => result.rows.some((row) => row.name === name));
}

function cleanup(sourceExpression: 'OLD.id' | 'NEW.source_id'): string {
  return `DELETE FROM langgraph_checkpoint_writes WHERE thread_id IN
    (SELECT thread_id FROM langgraph_checkpoint_sources WHERE source_record_id = ${sourceExpression});
    DELETE FROM langgraph_checkpoints WHERE thread_id IN
    (SELECT thread_id FROM langgraph_checkpoint_sources WHERE source_record_id = ${sourceExpression});
    DELETE FROM langgraph_checkpoint_sources WHERE source_record_id = ${sourceExpression};
    DELETE FROM healthkit_sync_checkpoints WHERE
    ${approvalKey} AND ${approvalSource} = ${sourceExpression};`;
}

/** Source-linked graphs may retain review text. Delete their existing checkpoint rows with the source, atomically. */
export async function createSourceLinkedCheckpointIntegrity(database: SqlDatabase): Promise<void> {
  await database.transaction(async (transaction) => {
    await transaction.execute(`CREATE TABLE IF NOT EXISTS langgraph_checkpoint_sources (
      thread_id TEXT PRIMARY KEY NOT NULL,
      source_record_id TEXT NOT NULL
    )`);
    // Each transcript identity fence fires the cleanup trigger; unrelated history must not multiply its work.
    await installCleanupIndexes(transaction);
    await transaction.execute(`CREATE TRIGGER IF NOT EXISTS source_records_delete_linked_checkpoints
      AFTER DELETE ON source_records BEGIN ${cleanup('OLD.id')} END`);
    for (const table of await existingMarkers(transaction)) {
      await transaction.execute(`CREATE TRIGGER IF NOT EXISTS ${table}_delete_linked_checkpoints
        AFTER INSERT ON ${table} BEGIN ${cleanup('NEW.source_id')} END`);
    }
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
  await requireLiveCheckpointSource(transaction, sourceId);
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

/** Logical removal commits before physical deletion; neither state can authorize fresh graph work or durable writes. */
export async function requireLiveCheckpointSource(
  sql: SqlExecutor,
  sourceId: string,
): Promise<void> {
  if (!(await isLiveCheckpointSource(sql, RecordIdSchema.parse(sourceId))))
    throw new Error('Checkpoint source was removed.');
}

async function isLiveCheckpointSource(sql: SqlExecutor, sourceId: string): Promise<boolean> {
  const present = await sql.execute('SELECT id FROM source_records WHERE id = ?', [sourceId]);
  if (!present.rows.length) return false;
  for (const table of await existingMarkers(sql)) {
    const removed = await sql.execute(`SELECT source_id FROM ${table} WHERE source_id = ?`, [
      sourceId,
    ]);
    if (removed.rows.length) return false;
  }
  return true;
}

/** A scoped read may only reopen an existing live binding, never initialize one. */
async function canReadSourceLinkedCheckpoint(
  sql: SqlExecutor,
  threadId: string,
  sourceRecordId: string,
): Promise<boolean> {
  const sourceId = RecordIdSchema.parse(sourceRecordId);
  const tables = await sql.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('langgraph_checkpoint_sources', 'langgraph_checkpoints', 'langgraph_checkpoint_writes', 'source_records')",
  );
  if (tables.rows.length !== 4) return false;
  const bound = await sql.execute(
    'SELECT source_record_id FROM langgraph_checkpoint_sources WHERE thread_id = ?',
    [threadId],
  );
  return (
    bound.rows[0]?.source_record_id === sourceId && (await isLiveCheckpointSource(sql, sourceId))
  );
}

export async function readSourceLinkedCheckpoint<T>(
  database: SqlDatabase,
  threadId: string,
  sourceId: string,
  absent: T,
  read: (executor: SqlExecutor) => Promise<T>,
): Promise<T> {
  let result = absent;
  // Authorize source and read both checkpoint and pending writes in one snapshot.
  await database.transaction(async (transaction) => {
    if (await canReadSourceLinkedCheckpoint(transaction, threadId, sourceId))
      result = await read(transaction);
  });
  return result;
}
