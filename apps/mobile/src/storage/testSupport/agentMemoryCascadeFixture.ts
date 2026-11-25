import { createAgentMemory } from '@orot/agent-memory';
import type { PersistedMemoryRecord } from '@orot/agent-memory';
import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { SqlCipherAgentMemoryStorage } from '../agentMemoryStorage';

export const sourceId = 'fixture-recording';
export const descendantId = 'fixture-segment';

export function row(id: string, source: string, namespace = ['owner-a']) {
  return {
    id,
    text: 'A synthetic memory.',
    vector: Float32Array.from([1, 0]),
    entities: [],
    tags: ['preference'],
    importance: 0.5,
    createdAt: Date.parse('2026-11-25T01:00:00.000Z'),
    reinforcements: 0,
    meta: {
      memoryKey: id,
      kind: 'preference',
      namespace,
      provenance: { sourceIds: [source], reviewState: 'human_reviewed' },
    },
  } satisfies PersistedMemoryRecord;
}

export async function fixture(legacy = false) {
  const { database, close } = openSqliteTestDatabase(':memory:');
  await runMigrations(database);
  const storage = new SqlCipherAgentMemoryStorage(database);
  await storage.listRecords();
  if (legacy)
    Object.defineProperty(storage, 'commitSourceCascade', { value: undefined });
  const seed = async (record: PersistedMemoryRecord) => {
    // Explicitly replace a fixture under the same ID to simulate an independently committed correction.
    await database.execute(
      'INSERT OR REPLACE INTO agent_memory_records (id, record_json) VALUES (?,?)',
      [record.id, JSON.stringify({ ...record, vector: [...record.vector] })],
    );
  };
  const ids = async () =>
    (
      await database.execute('SELECT id FROM agent_memory_records ORDER BY id')
    ).rows.map(record => record.id);
  const openMemory = (namespace = ['owner-a']) =>
    createAgentMemory({
      embedder: {
        embed: async (texts: string[]) =>
          texts.map(() => Float32Array.from([1, 0])),
      },
      storage,
      namespace,
    });
  const receipt = jest.fn(async () => true);
  return { database, close, storage, seed, ids, openMemory, receipt };
}
