import type { PersistedMemoryRecord } from '@orot/agent-memory';
import type {
  SqlDatabase,
  SqlResult,
  SqlTransaction,
  SqlValue,
} from '@orot/storage';
import { SqlCipherAgentMemoryStorage } from '../agentMemoryStorage';

class TranscriptMemoryDatabase implements SqlDatabase {
  readonly records = new Map<string, string>();
  readonly invalidatedSourceIds = new Set<string>();

  async execute(
    query: string,
    parameters: SqlValue[] = [],
  ): Promise<SqlResult> {
    return this.run(query, parameters);
  }

  async transaction(
    operation: (transaction: SqlTransaction) => Promise<void>,
  ): Promise<void> {
    const transaction: SqlTransaction = {
      execute: (query, parameters = []) => this.run(query, parameters),
      commit: () => ({ rows: [] }),
      rollback: () => ({ rows: [] }),
    };
    await operation(transaction);
  }

  private async run(query: string, parameters: SqlValue[]): Promise<SqlResult> {
    if (query.startsWith('CREATE TABLE')) return { rows: [] };
    if (query.startsWith('SELECT source_id FROM agent_memory_removed_sources'))
      return { rows: [] };
    if (query.startsWith('SELECT DISTINCT json_extract(payload_json')) {
      return {
        rows: [...this.invalidatedSourceIds].map(source_id => ({ source_id })),
      };
    }
    if (query.startsWith('SELECT id, record_json FROM agent_memory_records')) {
      return {
        rows: [...this.records].map(([id, record_json]) => ({
          id,
          record_json,
        })),
      };
    }
    if (query.startsWith('DELETE FROM agent_memory_records WHERE id = ?')) {
      this.records.delete(String(parameters[0]));
      return { rows: [], rowsAffected: 1 };
    }
    if (query.startsWith('DELETE FROM agent_memory_records')) {
      this.records.clear();
      return { rows: [] };
    }
    if (query.startsWith('INSERT OR REPLACE INTO agent_memory_records')) {
      this.records.set(String(parameters[0]), String(parameters[1]));
      return { rows: [], rowsAffected: 1 };
    }
    throw new Error(`Unexpected synthetic SQL: ${query}`);
  }
}

function record(id: string, sourceId: string): PersistedMemoryRecord {
  return {
    id,
    text: `memory:${id}`,
    vector: new Float32Array([1]),
    tags: ['preference'],
    entities: [],
    importance: 0.5,
    meta: {
      memoryKey: id,
      kind: 'preference',
      provenance: {
        sourceIds: [sourceId],
        sourceDates: [],
        reviewState: 'user_confirmed',
      },
    },
    createdAt: 1,
    reinforcements: 0,
  };
}

describe('SQLCipher agent-memory transcript invalidation', () => {
  it('removes persisted memories tied to a superseded transcript revision', async () => {
    const database = new TranscriptMemoryDatabase();
    const oldRevision = 'recording-1:segment:0:r1';
    const currentRevision = 'recording-1:segment:0:r2';
    const stale = record('stale-memory', oldRevision);
    const current = record('current-memory', currentRevision);
    database.invalidatedSourceIds.add(oldRevision);
    database.records.set(
      stale.id,
      JSON.stringify({ ...stale, vector: Array.from(stale.vector) }),
    );
    database.records.set(
      current.id,
      JSON.stringify({ ...current, vector: Array.from(current.vector) }),
    );

    const storage = new SqlCipherAgentMemoryStorage(database);
    const loaded = await storage.load();

    expect(loaded.map(item => item.id)).toEqual([current.id]);
    expect(database.records.has(stale.id)).toBe(false);
    expect(database.records.has(current.id)).toBe(true);
  });

  it('rejects a new memory write that cites a superseded transcript revision', async () => {
    const database = new TranscriptMemoryDatabase();
    const oldRevision = 'recording-1:segment:0:r1';
    database.invalidatedSourceIds.add(oldRevision);
    const storage = new SqlCipherAgentMemoryStorage(database);

    await expect(
      storage.append(record('stale-memory', oldRevision)),
    ).rejects.toThrow('superseded transcript revision');
    expect(database.records.size).toBe(0);
  });
});
