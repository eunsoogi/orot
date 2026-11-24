import { createAgentMemory } from '@orot/agent-memory';
import { runMigrations } from '@orot/storage';
import type { SqlDatabase } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { guardedNativeDatabase } from '../protectedReadEpoch';
import { SqlCipherAgentMemoryStorage } from '../agentMemoryStorage';

declare const require: (specifier: string) => unknown;

interface TestFileSystem {
  mkdtempSync(prefix: string): string;
  rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
}

const { mkdtempSync, rmSync } = require('node:fs') as TestFileSystem;
const { tmpdir } = require('node:os') as { tmpdir(): string };
const { join } = require('node:path') as { join(...parts: string[]): string };

async function openDatabase(path: string): Promise<SqlDatabase> {
  const sqlite = openSqliteTestDatabase(path);
  const database = guardedNativeDatabase({
    ...sqlite.database,
    closeAsync: async () => sqlite.close(),
  });
  // Match production: register the guarded owner and migrate before any Memory writer.
  try {
    await runMigrations(database);
    return database;
  } catch (error) {
    await database.closeAsync();
    throw error;
  }
}

const embedder = {
  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map(text => {
      const vector = new Float32Array(16);
      for (const character of text)
        vector[character.charCodeAt(0) % vector.length] += 1;
      return vector;
    });
  },
};

const linkedMemory = {
  memoryKey: 'reviewed:linked-preference',
  text: '합성 출처와 연결된 검토 메모리.',
  kind: 'preference' as const,
  provenance: {
    sourceIds: ['synthetic-source-1'],
    reviewState: 'human_reviewed' as const,
  },
};
const unlinkedMemory = {
  memoryKey: 'reviewed:unlinked-preference',
  text: '합성 출처와 연결되지 않은 검토 메모리.',
  kind: 'preference' as const,
  provenance: { sourceIds: [], reviewState: 'human_reviewed' as const },
};

/** Read witness metadata without fetching the saved body. */
async function readWitness(database: SqlDatabase, id: string) {
  return (
    await database.execute(
      'SELECT recent_metadata_version AS version, recent_created_at_ms AS clock FROM agent_memory_records WHERE id = ?',
      [id],
    )
  ).rows[0];
}

describe('SQLCipher-backed agent-memory deletion', () => {
  it('removes linked and unlinked memory through Rememori and persists after database reopen', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'orot-agent-memory-delete-'));
    const databasePath = join(directory, 'agent-memory.sqlite');
    let database = await openDatabase(databasePath);
    try {
      const memory = await createAgentMemory({
        embedder,
        storage: new SqlCipherAgentMemoryStorage(database),
      });
      const linkedId = await memory.remember(linkedMemory);
      const unlinkedId = await memory.remember(unlinkedMemory);
      expect(await readWitness(database, linkedId)).toEqual({
        version: null,
        clock: null,
      });
      const unlinkedWitness = await readWitness(database, unlinkedId);
      expect(unlinkedWitness).toEqual({
        version: 1,
        clock: expect.any(Number),
      });

      await expect(memory.forgetAll(['synthetic-source-2'])).resolves.toBe(2);
      await expect(memory.recall(linkedMemory.text)).resolves.toEqual([]);
      await expect(memory.recall(unlinkedMemory.text)).resolves.toEqual([]);
      await memory.close();
      await database.closeAsync?.();

      database = await openDatabase(databasePath);
      const storage = new SqlCipherAgentMemoryStorage(database);
      const reopened = await createAgentMemory({ embedder, storage });
      await expect(storage.listRecords()).resolves.toEqual([]);
      expect(await readWitness(database, linkedId)).toBeUndefined();
      expect(await readWitness(database, unlinkedId)).toBeUndefined();
      // Memory-row IDs remain fenced too, including the unlinked memory identity.
      await expect(storage.listRemovedSourceIds()).resolves.toEqual(
        [
          linkedId,
          unlinkedId,
          'synthetic-source-1',
          'synthetic-source-2',
        ].sort(),
      );
      await expect(reopened.remember(linkedMemory)).rejects.toThrow(
        'already removed',
      );
      await expect(reopened.recall(unlinkedMemory.text)).resolves.toEqual([]);
      await reopened.close();
    } finally {
      await database.closeAsync?.();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rolls back source fences and every memory row when the deletion transaction fails', async () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'orot-agent-memory-rollback-'),
    );
    const database = await openDatabase(join(directory, 'agent-memory.sqlite'));
    try {
      const storage = new SqlCipherAgentMemoryStorage(database);
      const memory = await createAgentMemory({ embedder, storage });
      const linkedId = await memory.remember(linkedMemory);
      const unlinkedId = await memory.remember(unlinkedMemory);
      expect(await readWitness(database, linkedId)).toEqual({
        version: null,
        clock: null,
      });
      const unlinkedWitness = await readWitness(database, unlinkedId);
      expect(unlinkedWitness).toEqual({
        version: 1,
        clock: expect.any(Number),
      });
      await database.execute(`
        CREATE TRIGGER reject_memory_delete
        BEFORE DELETE ON agent_memory_records
        BEGIN SELECT RAISE(ABORT, 'injected memory deletion failure'); END
      `);

      await expect(memory.forgetAll(['synthetic-source-2'])).rejects.toThrow(
        'injected memory deletion failure',
      );

      const restoredRecords = await storage.listRecords();
      expect(restoredRecords).toHaveLength(2);
      expect(restoredRecords).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: linkedId, text: linkedMemory.text }),
          expect.objectContaining({
            id: unlinkedId,
            text: unlinkedMemory.text,
          }),
        ]),
      );
      expect(await readWitness(database, unlinkedId)).toEqual(unlinkedWitness);
      await expect(storage.listRemovedSourceIds()).resolves.toEqual([]);
      const recalled = await memory.recall(unlinkedMemory.text);
      expect(recalled).toHaveLength(2);
      expect(recalled).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: linkedId }),
          expect.objectContaining({ id: unlinkedId }),
        ]),
      );
      await database.execute('DROP TRIGGER reject_memory_delete');
      await expect(memory.forgetAll(['synthetic-source-2'])).resolves.toBe(2);
      await memory.close();
    } finally {
      await database.closeAsync?.();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
