import type { SqlDatabase, SqlValue } from './sql';
import type { StoredCheckpoint, StoredCheckpointWrite } from './checkpointStorage';

export async function createSchema(database: SqlDatabase): Promise<void> {
  await database.execute(`CREATE TABLE IF NOT EXISTS langgraph_checkpoints (
    thread_id TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL,
    checkpoint_id TEXT NOT NULL,
    parent_checkpoint_id TEXT,
    checkpoint_type TEXT NOT NULL,
    checkpoint BLOB NOT NULL,
    metadata_type TEXT NOT NULL,
    metadata BLOB NOT NULL,
    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
  )`);
  await database.execute(`CREATE TABLE IF NOT EXISTS langgraph_checkpoint_writes (
    thread_id TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL,
    checkpoint_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    channel TEXT NOT NULL,
    type TEXT NOT NULL,
    value BLOB NOT NULL,
    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
  )`);
}

export function readCheckpoint(row: Record<string, SqlValue>): StoredCheckpoint {
  const parent = row.parent_checkpoint_id;
  return {
    checkpointId: readText(row, 'checkpoint_id')!,
    parentCheckpointId: parent === null || parent === undefined ? null : String(parent),
    checkpointType: readText(row, 'checkpoint_type')!,
    checkpoint: readBytes(row.checkpoint, 'checkpoint'),
    metadataType: readText(row, 'metadata_type')!,
    metadata: readBytes(row.metadata, 'metadata'),
  };
}

export function readWrite(
  row: Record<string, SqlValue>,
): Omit<StoredCheckpointWrite, 'replaceExisting' | 'index'> {
  return {
    taskId: readText(row, 'task_id')!,
    channel: readText(row, 'channel')!,
    type: readText(row, 'type')!,
    value: readBytes(row.value, 'write value'),
  };
}

export function readText(row: Record<string, SqlValue>, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new Error(`Invalid ${key} in checkpoint storage.`);
  return value;
}

function readBytes(value: SqlValue, key: string): Uint8Array {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new Error(`Invalid ${key} bytes in checkpoint storage.`);
}
