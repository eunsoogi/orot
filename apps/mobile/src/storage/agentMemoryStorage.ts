import type { SqlDatabase, SqlTransaction } from '@orot/storage';
import type {
  AgentMemoryStorageAdapter,
  PersistedMemoryRecord,
} from '@orot/agent-memory';

type PendingWrite = PersistedMemoryRecord | null;
interface PendingBatch {
  readonly writes: Map<string, PendingWrite>;
  readonly removedSourceIds: Set<string>;
}

/** Persists only Rememori records inside the app's existing SQLCipher database. */
export class SqlCipherAgentMemoryStorage implements AgentMemoryStorageAdapter {
  private tableReady: Promise<void> | null = null;
  private pending: PendingBatch | null = null;

  constructor(private readonly database: SqlDatabase) {}

  async load(): Promise<PersistedMemoryRecord[]> {
    await this.ensureTable();
    const result = await this.database.execute(
      'SELECT record_json FROM agent_memory_records ORDER BY id',
    );
    const removedSourceIds = new Set(await this.listRemovedSourceIds());
    return result.rows
      .map(row => decodeRecord(row.record_json))
      .filter(record => !referencesRemovedSource(record, removedSourceIds));
  }

  async listRecords(): Promise<PersistedMemoryRecord[]> {
    return this.load();
  }

  async append(record: PersistedMemoryRecord): Promise<void> {
    if (this.pending) {
      this.pending.writes.set(record.id, record);
      return;
    }
    await this.executeWrites(new Map([[record.id, record]]), new Set());
  }

  async tombstone(id: string): Promise<void> {
    if (this.pending) {
      this.pending.writes.set(id, null);
      return;
    }
    await this.executeWrites(new Map([[id, null]]), new Set());
  }

  async compact(records: PersistedMemoryRecord[]): Promise<void> {
    if (this.pending)
      throw new Error('Cannot compact agent memory during a write batch.');
    await this.ensureTable();
    await this.database.transaction(async transaction => {
      const removedResult = await transaction.execute(
        'SELECT source_id FROM agent_memory_removed_sources ORDER BY source_id',
      );
      const removedSourceIds = new Set(
        removedResult.rows.flatMap(row =>
          typeof row.source_id === 'string' ? [row.source_id] : [],
        ),
      );
      for (const record of records)
        assertNoRemovedSourceReference(record, removedSourceIds);
      await transaction.execute('DELETE FROM agent_memory_records');
      for (const record of records) await insertRecord(transaction, record);
    });
  }

  async listRemovedSourceIds(): Promise<string[]> {
    await this.ensureTable();
    const result = await this.database.execute(
      'SELECT source_id FROM agent_memory_removed_sources ORDER BY source_id',
    );
    return result.rows.flatMap(row =>
      typeof row.source_id === 'string' ? [row.source_id] : [],
    );
  }

  async markSourceRemoved(sourceId: string): Promise<void> {
    const normalizedId = sourceId.trim();
    if (!normalizedId) throw new Error('A source identifier is required.');
    if (this.pending) {
      this.pending.removedSourceIds.add(normalizedId);
      return;
    }
    await this.executeWrites(new Map(), new Set([normalizedId]));
  }

  beginBatch(): void {
    if (this.pending)
      throw new Error('An agent-memory write batch is already open.');
    this.pending = { writes: new Map(), removedSourceIds: new Set() };
  }

  async commitBatch(): Promise<void> {
    if (!this.pending) throw new Error('No agent-memory write batch is open.');
    const batch = this.pending;
    await this.executeWrites(batch.writes, batch.removedSourceIds);
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
      this.tableReady = this.database
        .execute(
          'CREATE TABLE IF NOT EXISTS agent_memory_records (id TEXT PRIMARY KEY NOT NULL, record_json TEXT NOT NULL)',
        )
        .then(async () => {
          await this.database.execute(
            'CREATE TABLE IF NOT EXISTS agent_memory_removed_sources (source_id TEXT PRIMARY KEY NOT NULL)',
          );
        })
        .catch(error => {
          this.tableReady = null;
          throw error;
        });
    }
    await this.tableReady;
  }

  private async executeWrites(
    writes: Map<string, PendingWrite>,
    removedSourceIdsToAdd: Set<string>,
  ): Promise<void> {
    await this.ensureTable();
    await this.database.transaction(async transaction => {
      const removedResult = await transaction.execute(
        'SELECT source_id FROM agent_memory_removed_sources ORDER BY source_id',
      );
      const removedSourceIds = new Set(
        removedResult.rows.flatMap(row =>
          typeof row.source_id === 'string' ? [row.source_id] : [],
        ),
      );
      for (const sourceId of removedSourceIdsToAdd)
        removedSourceIds.add(sourceId);
      for (const record of writes.values()) {
        if (record) assertNoRemovedSourceReference(record, removedSourceIds);
      }
      if (removedSourceIdsToAdd.size > 0) {
        const records = await transaction.execute(
          'SELECT id, record_json FROM agent_memory_records ORDER BY id',
        );
        for (const row of records.rows) {
          const record = decodeRecord(row.record_json);
          if (referencesRemovedSource(record, removedSourceIds)) {
            await transaction.execute(
              'DELETE FROM agent_memory_records WHERE id = ?',
              [record.id],
            );
          }
        }
      }
      for (const [id, record] of writes) {
        if (record) await insertRecord(transaction, record);
        else
          await transaction.execute(
            'DELETE FROM agent_memory_records WHERE id = ?',
            [id],
          );
      }
      for (const sourceId of removedSourceIdsToAdd) {
        await transaction.execute(
          'INSERT OR IGNORE INTO agent_memory_removed_sources (source_id) VALUES (?)',
          [sourceId],
        );
      }
    });
  }
}

function referencesRemovedSource(
  record: PersistedMemoryRecord,
  removedSourceIds: Set<string>,
): boolean {
  const provenance = record.meta.provenance;
  if (!provenance || typeof provenance !== 'object') return false;
  const sourceIds = (provenance as { sourceIds?: unknown }).sourceIds;
  return (
    Array.isArray(sourceIds) &&
    sourceIds.some(
      sourceId =>
        typeof sourceId === 'string' && removedSourceIds.has(sourceId),
    )
  );
}

function assertNoRemovedSourceReference(
  record: PersistedMemoryRecord,
  removedSourceIds: Set<string>,
): void {
  if (referencesRemovedSource(record, removedSourceIds)) {
    throw new Error(
      'Memory cannot reference a source being or already removed.',
    );
  }
}

async function insertRecord(
  transaction: SqlTransaction,
  record: PersistedMemoryRecord,
): Promise<void> {
  const serialized = JSON.stringify({
    ...record,
    vector: Array.from(record.vector),
  });
  await transaction.execute(
    'INSERT OR REPLACE INTO agent_memory_records (id, record_json) VALUES (?, ?)',
    [record.id, serialized],
  );
}

function decodeRecord(value: unknown): PersistedMemoryRecord {
  if (typeof value !== 'string')
    throw new Error('Encrypted agent-memory data is invalid.');
  const parsed = JSON.parse(value) as Omit<PersistedMemoryRecord, 'vector'> & {
    vector?: unknown;
  };
  if (
    typeof parsed.id !== 'string' ||
    typeof parsed.text !== 'string' ||
    !Array.isArray(parsed.vector) ||
    parsed.vector.some(vectorValue => typeof vectorValue !== 'number') ||
    !Array.isArray(parsed.tags) ||
    !Array.isArray(parsed.entities) ||
    typeof parsed.importance !== 'number' ||
    !parsed.meta ||
    typeof parsed.meta !== 'object' ||
    typeof parsed.createdAt !== 'number' ||
    typeof parsed.reinforcements !== 'number'
  ) {
    throw new Error('Encrypted agent-memory data is invalid.');
  }
  return {
    ...parsed,
    vector: Float32Array.from(parsed.vector),
  } as PersistedMemoryRecord;
}
