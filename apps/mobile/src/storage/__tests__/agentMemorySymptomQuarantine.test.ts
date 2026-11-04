import { createAgentMemory } from '@orot/agent-memory';
import { createHealthEvidenceTestDatabase } from '../../healthEvidence/localEvidenceTestSupport';
import { runMigrations } from '@orot/storage';
import { SqlCipherAgentMemoryStorage } from '../agentMemoryStorage';
declare const require: (name: string) => unknown;
const { mkdtempSync, rmSync } = require('node:fs') as {
  mkdtempSync(prefix: string): string;
  rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
};
const { tmpdir } = require('node:os') as { tmpdir(): string };
const { join } = require('node:path') as { join(...parts: string[]): string };

test('quarantines ambiguous approved memory without deleting it and keeps typed unrelated memory', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-symptom-memory-'));
  const path = join(directory, 'records.sqlite');
  const first = createHealthEvidenceTestDatabase(path);
  const { database } = first;
  let reopened: ReturnType<typeof createHealthEvidenceTestDatabase> | undefined;
  let memory: Awaited<ReturnType<typeof createAgentMemory>> | undefined;
  try {
    await runMigrations(database);
    const storage = new SqlCipherAgentMemoryStorage(database);
    memory = await createAgentMemory({
      storage,
      embedder: {
        embed: async texts => texts.map(() => new Float32Array(16).fill(1)),
      },
    });
    const common = {
      kind: 'task_context' as const,
      text: 'Synthetic approved text',
    };
    await memory.remember({
      ...common,
      memoryKey: 'legacy',
      provenance: { sourceIds: ['same'], reviewState: 'human_reviewed' },
    });
    await memory.remember({
      ...common,
      memoryKey: 'other',
      provenance: {
        sourceIds: ['same'],
        sourceReferences: [{ kind: 'manual_history', id: 'same' }],
        reviewState: 'human_reviewed',
      },
    });
    await memory.remember({
      ...common,
      memoryKey: 'mixed',
      provenance: {
        sourceIds: ['same', 'recording'],
        reviewState: 'human_reviewed',
      },
    });
    await database.execute(
      'CREATE TABLE IF NOT EXISTS legacy_symptom_deleted (id TEXT PRIMARY KEY NOT NULL)',
    );
    await database.execute(
      'INSERT INTO legacy_symptom_deleted (id) VALUES (?)',
      ['same'],
    );
    expect(await memory.getByKey('legacy')).toBeNull();
    expect(await memory.getByKey('other')).not.toBeNull();
    expect(
      (await memory.recall('Synthetic')).map(hit => hit.memoryKey),
    ).toEqual(['other']);
    expect(
      (await database.execute('SELECT id FROM agent_memory_records')).rows,
    ).toHaveLength(3);
    await storage.markSourceRemoved('recording');
    expect(
      (await database.execute('SELECT id FROM agent_memory_records')).rows,
    ).toHaveLength(2);
    await expect(
      memory.remember({
        ...common,
        memoryKey: 'late',
        provenance: { sourceIds: ['same'], reviewState: 'human_reviewed' },
      }),
    ).rejects.toThrow('deleted symptom');
    await expect(storage.compact(await storage.listRecords())).rejects.toThrow(
      'Quarantined memory',
    );
    expect(
      (await database.execute('SELECT id FROM agent_memory_records')).rows,
    ).toHaveLength(2);
    await memory.close();
    memory = undefined;
    first.close();
    reopened = createHealthEvidenceTestDatabase(path);
    const restartedStorage = new SqlCipherAgentMemoryStorage(reopened.database);
    memory = await createAgentMemory({
      storage: restartedStorage,
      embedder: {
        embed: async texts => texts.map(() => new Float32Array(16).fill(1)),
      },
    });
    expect(await memory.getByKey('legacy')).toBeNull();
    expect(await memory.getByKey('other')).not.toBeNull();
    expect(
      (await reopened.database.execute('SELECT id FROM agent_memory_records'))
        .rows,
    ).toHaveLength(2);
    await expect(memory.forgetAll()).resolves.toBe(2);
    expect(
      (await reopened.database.execute('SELECT id FROM agent_memory_records'))
        .rows,
    ).toHaveLength(0);
  } finally {
    await memory?.close();
    if (reopened) reopened.close();
    else first.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
