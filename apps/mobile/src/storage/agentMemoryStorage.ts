import type { SqlDatabase, SqlTransaction } from '@orot/storage';
import type { AgentMemoryStorageAdapter, PersistedMemoryRecord } from '@orot/agent-memory';

type PendingWrite = PersistedMemoryRecord | null;

/** Persists only Rememori records inside the app's existing SQLCipher database. */
export class SqlCipherAgentMemoryStorage implements AgentMemoryStorageAdapter {
  private tableReady: Promise<void> | null = null;
  private pending: Map<string, PendingWrite> | null = null;

  constructor(private readonly database: SqlDatabase) {}

  async load(): Promise<PersistedMemoryRecord[]> {
    await this.ensureTable();
    const result = await this.database.execute(
      'SELECT record_json FROM agent_memory_records ORDER BY id',
    );
    return result.rows.map(row => decodeRecord(row.record_json));
  }

  async listRecords(): Promise<PersistedMemoryRecord[]> {
    return this.load();
  }

  async append(record: PersistedMemoryRecord): Promise<void> {
    if (this.pending) {
      this.pending.set(record.id, record);
      return;
    }
    await this.executeWrites(new Map([[record.id, record]]));
  }

  async tombstone(id: string): Promise<void> {
    if (this.pending) {
      this.pending.set(id, null);
      return;
    }
    await this.executeWrites(new Map([[id, null]]));
  }

  async compact(records: PersistedMemoryRecord[]): Promise<void> {
    if (this.pending) throw new Error('Cannot compact agent memory during a write batch.');
    await this.ensureTable();
    await this.database.transaction(async transaction => {
      await transaction.execute('DELETE FROM agent_memory_records');
      for (const record of records) await insertRecord(transaction, record);
    });
  }

  beginBatch(): void {
    if (this.pending) throw new Error('An agent-memory write batch is already open.');
    this.pending = new Map();
  }

  async commitBatch(): Promise<void> {
    if (!this.pending) throw new Error('No agent-memory write batch is open.');
    const writes = this.pending;
    await this.executeWrites(writes);
    this.pending = null;
  }

  rollbackBatch(): void {
    this.pending = null;
  }

  async close(): Promise<void> {
    // The database connection belongs to secureDatabase.ts and remains open for the app.
  }

  private async ensureTable(): Promise<void> {
    if (!this.tableReady) {
      this.tableReady = this.database.execute(
        'CREATE TABLE IF NOT EXISTS agent_memory_records (id TEXT PRIMARY KEY NOT NULL, record_json TEXT NOT NULL)',
      ).then(() => undefined).catch(error => {
        this.tableReady = null;
        throw error;
      });
    }
    await this.tableReady;
  }

  private async executeWrites(writes: Map<string, PendingWrite>): Promise<void> {
    await this.ensureTable();
    await this.database.transaction(async transaction => {
      for (const [id, record] of writes) {
        if (record) await insertRecord(transaction, record);
        else await transaction.execute('DELETE FROM agent_memory_records WHERE id = ?', [id]);
      }
    });
  }
}

async function insertRecord(
  transaction: SqlTransaction,
  record: PersistedMemoryRecord,
): Promise<void> {
  const serialized = JSON.stringify({ ...record, vector: Array.from(record.vector) });
  await transaction.execute(
    'INSERT OR REPLACE INTO agent_memory_records (id, record_json) VALUES (?, ?)',
    [record.id, serialized],
  );
}

function decodeRecord(value: unknown): PersistedMemoryRecord {
  if (typeof value !== 'string') throw new Error('Encrypted agent-memory data is invalid.');
  const parsed = JSON.parse(value) as Omit<PersistedMemoryRecord, 'vector'> & { vector?: unknown };
  if (
    typeof parsed.id !== 'string' || typeof parsed.text !== 'string' ||
    !Array.isArray(parsed.vector) || parsed.vector.some(vectorValue => typeof vectorValue !== 'number') ||
    !Array.isArray(parsed.tags) || !Array.isArray(parsed.entities) ||
    typeof parsed.importance !== 'number' || !parsed.meta || typeof parsed.meta !== 'object' ||
    typeof parsed.createdAt !== 'number' || typeof parsed.reinforcements !== 'number'
  ) {
    throw new Error('Encrypted agent-memory data is invalid.');
  }
  return { ...parsed, vector: Float32Array.from(parsed.vector) } as PersistedMemoryRecord;
}
