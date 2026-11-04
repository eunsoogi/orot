import { commitAgentMemoryWrites } from './agentMemoryStorageWrites';
import type { SqlDatabase } from '@orot/storage';
import { listInvalidatedHealthPeriods } from './healthPeriodDependencies';
import {
  deletedSymptomIds,
  listAllMemoryRecords,
  referencesDeletedSymptom,
  symptomQuarantineRevision,
} from './agentMemorySymptomQuarantine';
import { compactAgentMemory } from './agentMemoryCompaction';
import { ensureTypedDeletionMarkers } from './typedDeletionMarkers';
import type {
  AgentMemoryStorageAdapter,
  PersistedMemoryRecord,
} from '@orot/agent-memory';
import {
  decodeAgentMemoryRecord,
  listSupersededTranscriptRevisionIds,
  referencesAnySource,
} from './agentMemoryStorageRecords';

interface PendingBatch {
  readonly writes: Map<string, PersistedMemoryRecord | null>;
  readonly removedSourceIds: Set<string>;
  readonly removedKinds: Map<string, readonly string[] | undefined>;
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
      const removedSymptoms = await deletedSymptomIds(transaction);
      const result = await transaction.execute(
        'SELECT id, record_json FROM agent_memory_records ORDER BY id',
      );
      for (const row of result.rows) {
        const record = decodeAgentMemoryRecord(row.record_json);
        if (referencesDeletedSymptom(record, removedSymptoms)) continue;
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

  async listAllRecordsForPurge(): Promise<PersistedMemoryRecord[]> {
    await this.ensureTable();
    return listAllMemoryRecords(this.database);
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
    await this.database.transaction(transaction =>
      compactAgentMemory(transaction, records),
    );
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
    // Period deletion can fence a derived version while the Rememori engine is already open.
    // Refreshing through the existing invalidation port prevents its cached text from resurfacing.
    return [
      ...new Set([
        ...(await listSupersededTranscriptRevisionIds(this.database)),
        ...(await listInvalidatedHealthPeriods(this.database)),
      ]),
    ];
  }

  listQuarantineRevision = () => symptomQuarantineRevision(this.database);
  async markSourceRemoved(
    sourceId: string,
    kinds?: readonly string[],
  ): Promise<void> {
    const normalizedId = sourceId.trim();
    if (!normalizedId) throw new Error('A source identifier is required.');
    if (this.pending) {
      this.pending.removedSourceIds.add(normalizedId);
      const prior = this.pending.removedKinds.get(normalizedId);
      const seen = this.pending.removedKinds.has(normalizedId);
      this.pending.removedKinds.set(
        normalizedId,
        !kinds || (seen && !prior)
          ? undefined
          : [...new Set([...(prior ?? []), ...kinds])],
      );
      return;
    }
    await this.executeWrites(
      new Map(),
      new Set([normalizedId]),
      new Map([[normalizedId, kinds]]),
    );
  }

  beginBatch(): void {
    if (this.pending)
      throw new Error('An agent-memory write batch is already open.');
    this.pending = {
      writes: new Map(),
      removedSourceIds: new Set(),
      removedKinds: new Map(),
    };
  }

  async commitBatch(): Promise<void> {
    if (!this.pending) throw new Error('No agent-memory write batch is open.');
    const batch = this.pending;
    await this.executeWrites(
      batch.writes,
      batch.removedSourceIds,
      batch.removedKinds,
    );
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
          await ensureTypedDeletionMarkers(this.database);
        })
        .catch(error => {
          this.tableReady = null;
          throw error;
        });
    }
    await this.tableReady;
  }

  private async executeWrites(
    writes: Map<string, PersistedMemoryRecord | null>,
    removedSourceIdsToAdd: Set<string>,
    removedKinds = new Map<string, readonly string[] | undefined>(),
  ): Promise<void> {
    await this.ensureTable();
    await commitAgentMemoryWrites(
      this.database,
      writes,
      removedSourceIdsToAdd,
      removedKinds,
    );
  }
}
