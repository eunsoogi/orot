import type { SqlDatabase, SqlExecutor, SqlValue } from './sql';
import { createSchema, readCheckpoint, readText, readWrite } from './checkpointStorageCodec';

export interface StoredCheckpoint {
  checkpointId: string;
  parentCheckpointId: string | null;
  checkpointType: string;
  checkpoint: Uint8Array;
  metadataType: string;
  metadata: Uint8Array;
}

export interface StoredCheckpointWrite {
  taskId: string;
  index: number;
  channel: string;
  type: string;
  value: Uint8Array;
  replaceExisting: boolean;
}

export interface CheckpointBundle extends StoredCheckpoint {
  threadId: string;
  namespace: string;
  pendingWrites: Array<Omit<StoredCheckpointWrite, 'replaceExisting' | 'index'>>;
}

export interface LangGraphCheckpointStorage {
  ensureSchema(): Promise<void>;
  saveCheckpoint(threadId: string, namespace: string, checkpoint: StoredCheckpoint): Promise<void>;
  saveWrites(
    threadId: string,
    namespace: string,
    checkpointId: string,
    writes: StoredCheckpointWrite[],
  ): Promise<void>;
  loadCheckpoint(
    threadId: string,
    namespace: string,
    checkpointId?: string,
  ): Promise<CheckpointBundle | undefined>;
  listCheckpoints(
    threadId: string,
    namespace?: string,
    beforeCheckpointId?: string,
    limit?: number,
  ): Promise<CheckpointBundle[]>;
  deleteThread(threadId: string): Promise<void>;
}

export function createLangGraphCheckpointStorage(
  database: SqlDatabase,
): LangGraphCheckpointStorage {
  let schema: Promise<void> | undefined;

  async function ensureSchema(): Promise<void> {
    if (!schema) {
      schema = createSchema(database).catch((error) => {
        schema = undefined;
        throw error;
      });
    }
    await schema;
  }

  async function readBundle(
    executor: SqlExecutor,
    threadId: string,
    namespace: string,
    row: Record<string, SqlValue>,
  ): Promise<CheckpointBundle> {
    const checkpoint = readCheckpoint(row);
    const writes = await executor.execute(
      `SELECT task_id, idx, channel, type, value
       FROM langgraph_checkpoint_writes
       WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?
       ORDER BY task_id ASC, idx ASC`,
      [threadId, namespace, checkpoint.checkpointId],
    );
    return {
      ...checkpoint,
      threadId,
      namespace,
      pendingWrites: writes.rows.map(readWrite),
    };
  }

  return {
    ensureSchema,

    async saveCheckpoint(threadId, namespace, checkpoint) {
      await ensureSchema();
      await database.transaction(async (transaction) => {
        await transaction.execute(
          `INSERT INTO langgraph_checkpoints
             (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id,
              checkpoint_type, checkpoint, metadata_type, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(thread_id, checkpoint_ns, checkpoint_id) DO UPDATE SET
             parent_checkpoint_id = excluded.parent_checkpoint_id,
             checkpoint_type = excluded.checkpoint_type,
             checkpoint = excluded.checkpoint,
             metadata_type = excluded.metadata_type,
             metadata = excluded.metadata`,
          [
            threadId,
            namespace,
            checkpoint.checkpointId,
            checkpoint.parentCheckpointId,
            checkpoint.checkpointType,
            checkpoint.checkpoint,
            checkpoint.metadataType,
            checkpoint.metadata,
          ],
        );
      });
    },

    async saveWrites(threadId, namespace, checkpointId, writes) {
      if (writes.length === 0) return;
      await ensureSchema();
      await database.transaction(async (transaction) => {
        for (const write of writes) {
          const conflict = write.replaceExisting
            ? `DO UPDATE SET channel = excluded.channel,
                type = excluded.type, value = excluded.value`
            : 'DO NOTHING';
          await transaction.execute(
            `INSERT INTO langgraph_checkpoint_writes
               (thread_id, checkpoint_ns, checkpoint_id, task_id, idx,
                channel, type, value)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
             ${conflict}`,
            [
              threadId,
              namespace,
              checkpointId,
              write.taskId,
              write.index,
              write.channel,
              write.type,
              write.value,
            ],
          );
        }
      });
    },

    async loadCheckpoint(threadId, namespace, checkpointId) {
      await ensureSchema();
      const byId = checkpointId !== undefined;
      const rows = await database.execute(
        `SELECT checkpoint_ns, checkpoint_id, parent_checkpoint_id, checkpoint_type,
                checkpoint, metadata_type, metadata
         FROM langgraph_checkpoints
         WHERE thread_id = ? AND checkpoint_ns = ?
           ${byId ? 'AND checkpoint_id = ?' : ''}
         ORDER BY checkpoint_id DESC LIMIT 1`,
        byId ? [threadId, namespace, checkpointId!] : [threadId, namespace],
      );
      const row = rows.rows[0];
      return row ? readBundle(database, threadId, namespace, row) : undefined;
    },

    async listCheckpoints(threadId, namespace, beforeCheckpointId, limit) {
      await ensureSchema();
      const clauses = ['thread_id = ?'];
      const parameters: SqlValue[] = [threadId];
      if (namespace !== undefined) {
        clauses.push('checkpoint_ns = ?');
        parameters.push(namespace);
      }
      if (beforeCheckpointId !== undefined) {
        clauses.push('checkpoint_id < ?');
        parameters.push(beforeCheckpointId);
      }
      const boundedLimit = limit === undefined ? undefined : Math.max(0, Math.floor(limit));
      const limitSql = boundedLimit === undefined ? '' : ' LIMIT ?';
      if (boundedLimit !== undefined) parameters.push(boundedLimit);
      const result = await database.execute(
        `SELECT checkpoint_ns, checkpoint_id, parent_checkpoint_id, checkpoint_type,
                checkpoint, metadata_type, metadata
         FROM langgraph_checkpoints
         WHERE ${clauses.join(' AND ')}
         ORDER BY checkpoint_id DESC${limitSql}`,
        parameters,
      );
      const bundles: CheckpointBundle[] = [];
      for (const value of result.rows) {
        bundles.push(
          await readBundle(database, threadId, readText(value, 'checkpoint_ns') ?? '', value),
        );
      }
      return bundles;
    },

    async deleteThread(threadId) {
      await ensureSchema();
      await database.transaction(async (transaction) => {
        await transaction.execute('DELETE FROM langgraph_checkpoint_writes WHERE thread_id = ?', [
          threadId,
        ]);
        await transaction.execute('DELETE FROM langgraph_checkpoints WHERE thread_id = ?', [
          threadId,
        ]);
      });
    },
  };
}
