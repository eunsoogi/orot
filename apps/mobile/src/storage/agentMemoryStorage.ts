import type { SqlDatabase } from '@orot/storage';
import type {
  AgentMemoryStorageAdapter,
  PersistedMemoryRecord,
} from '@orot/agent-memory';
import {
  assertNoSourceReference,
  decodeAgentMemoryRecord,
  insertAgentMemoryRecord,
  listSupersededTranscriptRevisionIds,
  referencesAnySource,
} from './agentMemoryStorageRecords';

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
    const retained: PersistedMemoryRecord[] = [];
    await this.database.transaction(async transaction => {
      const removedResult = await transaction.execute(
        'SELECT source_id FROM agent_memory_removed_sources ORDER BY source_id',
      );
      const removedSourceIds = new Set(
        removedResult.rows.flatMap(row =>
          typeof row.source_id === 'string' ? [row.source_id] : [],
        ),
      );
      const invalidatedSourceIds =
        await listSupersededTranscriptRevisionIds(transaction);
      const result = await transaction.execute(
        'SELECT id, record_json FROM agent_memory_records ORDER BY id',
      );
      for (const row of result.rows) {
        const record = decodeAgentMemoryRecord(row.record_json);
        if (
          referencesAnySource(record, removedSourceIds) ||
          referencesAnySource(record, invalidatedSourceIds)
        ) {
          await transaction.execute(
            'DELETE FROM agent_memory_records WHERE id = ?',
            [record.id],
          );
        } else retained.push(record);
      }
    });
    return retained;
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
      const invalidatedSourceIds =
        await listSupersededTranscriptRevisionIds(transaction);
      for (const record of records)
        assertNoSourceReference(
          record,
          removedSourceIds,
          'Memory cannot reference a source being or already removed.',
        );
      const currentRecords = records.filter(
        record => !referencesAnySource(record, invalidatedSourceIds),
      );
      await transaction.execute('DELETE FROM agent_memory_records');
      for (const record of currentRecords)
        await insertAgentMemoryRecord(transaction, record);
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

  async listInvalidatedSourceIds(): Promise<string[]> {
    await this.ensureTable();
    return [...(await listSupersededTranscriptRevisionIds(this.database))];
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
      const invalidatedSourceIds =
        await listSupersededTranscriptRevisionIds(transaction);
      for (const record of writes.values()) {
        if (record) {
          assertNoSourceReference(
            record,
            removedSourceIds,
            'Memory cannot reference a source being or already removed.',
          );
          assertNoSourceReference(
            record,
            invalidatedSourceIds,
            'Memory cannot reference a superseded transcript revision.',
          );
        }
      }
      if (removedSourceIdsToAdd.size > 0 || invalidatedSourceIds.size > 0) {
        const records = await transaction.execute(
          'SELECT id, record_json FROM agent_memory_records ORDER BY id',
        );
        for (const row of records.rows) {
          const record = decodeAgentMemoryRecord(row.record_json);
          if (
            referencesAnySource(record, removedSourceIds) ||
            referencesAnySource(record, invalidatedSourceIds)
          ) {
            await transaction.execute(
              'DELETE FROM agent_memory_records WHERE id = ?',
              [record.id],
            );
          }
        }
      }
      for (const [id, record] of writes) {
        if (record) await insertAgentMemoryRecord(transaction, record);
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
