import type {
  AgentMemoryInput,
  AgentMemoryStorageAdapter,
  PersistedMemoryRecord,
} from '../src/types';

export class PersistentMemoryStorage implements AgentMemoryStorageAdapter {
  private readonly records = new Map<string, PersistedMemoryRecord>();
  private removedSourceIds = new Set<string>();
  private pending: {
    readonly writes: Map<string, PersistedMemoryRecord | null>;
    readonly removedSourceIds: Set<string>;
  } | null = null;
  failNextCommit = false;

  async load(): Promise<PersistedMemoryRecord[]> {
    return this.listRecords();
  }

  async listRecords(): Promise<PersistedMemoryRecord[]> {
    return [...this.records.values()].filter(
      (record) => !referencesRemovedSource(record, this.removedSourceIds),
    );
  }

  async listRemovedSourceIds(): Promise<string[]> {
    return [...this.removedSourceIds];
  }

  async append(record: PersistedMemoryRecord): Promise<void> {
    if (this.pending) this.pending.writes.set(record.id, record);
    else {
      assertNoRemovedSourceReference(record, this.removedSourceIds);
      this.records.set(record.id, record);
    }
  }

  async tombstone(id: string): Promise<void> {
    if (this.pending) this.pending.writes.set(id, null);
    else this.records.delete(id);
  }

  async markSourceRemoved(sourceId: string): Promise<void> {
    if (this.pending) this.pending.removedSourceIds.add(sourceId);
    else this.removedSourceIds.add(sourceId);
  }

  async compact(records: PersistedMemoryRecord[]): Promise<void> {
    if (this.pending) throw new Error('Cannot compact during a write batch.');
    for (const record of records) assertNoRemovedSourceReference(record, this.removedSourceIds);
    this.records.clear();
    for (const record of records) this.records.set(record.id, record);
  }

  beginBatch(): void {
    if (this.pending) throw new Error('A write batch is already open.');
    this.pending = { writes: new Map(), removedSourceIds: new Set() };
  }

  async commitBatch(): Promise<void> {
    if (!this.pending) throw new Error('No write batch is open.');
    const removedSourceIds = new Set([...this.removedSourceIds, ...this.pending.removedSourceIds]);
    for (const record of this.pending.writes.values()) {
      if (record) assertNoRemovedSourceReference(record, removedSourceIds);
    }
    if (this.failNextCommit) {
      this.failNextCommit = false;
      throw new Error('Synthetic transaction failure.');
    }
    for (const [id, record] of this.pending.writes) {
      if (record) this.records.set(id, record);
      else this.records.delete(id);
    }
    this.removedSourceIds = removedSourceIds;
    for (const [id, record] of this.records) {
      if (referencesRemovedSource(record, this.removedSourceIds)) this.records.delete(id);
    }
    this.pending = null;
  }

  rollbackBatch(): void {
    this.pending = null;
  }

  async close(): Promise<void> {}
}

export const embedder = {
  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((text) => {
      const vector = new Float32Array(16);
      for (const character of text) vector[character.charCodeAt(0) % vector.length] += 1;
      return vector;
    });
  },
};

export const preference: AgentMemoryInput = {
  memoryKey: 'preference:reminder-time',
  text: '사용자는 외래 일정 알림을 하루 전에 받고 싶어 한다.',
  kind: 'preference',
  provenance: {
    sourceIds: ['synthetic-source-1'],
    sourceDates: [{ sourceId: 'synthetic-source-1', date: '2026-01-02T00:00:00Z' }],
    reviewState: 'user_confirmed',
  },
};

function referencesRemovedSource(
  record: PersistedMemoryRecord,
  removedSourceIds: Set<string>,
): boolean {
  const sourceIds = (record.meta.provenance as { sourceIds?: unknown } | undefined)?.sourceIds;
  return (
    Array.isArray(sourceIds) &&
    sourceIds.some((sourceId) => typeof sourceId === 'string' && removedSourceIds.has(sourceId))
  );
}

function assertNoRemovedSourceReference(
  record: PersistedMemoryRecord,
  removedSourceIds: Set<string>,
): void {
  if (referencesRemovedSource(record, removedSourceIds)) {
    throw new Error('Memory cannot reference a source being or already removed.');
  }
}
