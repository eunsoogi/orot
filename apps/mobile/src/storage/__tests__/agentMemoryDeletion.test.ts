import { createAgentMemory } from '@orot/agent-memory';
import type {
  SqlDatabase,
  SqlResult,
  SqlTransaction,
  SqlValue,
} from '@orot/storage';
import { SqlCipherAgentMemoryStorage } from '../agentMemoryStorage';

declare const require: (specifier: string) => unknown;

interface TestStatement {
  all(...parameters: SqlValue[]): Array<Record<string, SqlValue>>;
  run(...parameters: SqlValue[]): { changes: number };
}

interface TestConnection {
  prepare(query: string): TestStatement;
  exec(query: string): void;
  close(): void;
}

interface TestFileSystem {
  mkdtempSync(prefix: string): string;
  rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
}

const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => TestConnection;
};
const { mkdtempSync, rmSync } = require('node:fs') as TestFileSystem;
const { tmpdir } = require('node:os') as { tmpdir(): string };
const { join } = require('node:path') as { join(...parts: string[]): string };

function openDatabase(path: string): SqlDatabase {
  // Use real SQLite so deletion batches and restart reads exercise the persisted adapter contract.
  const connection = new DatabaseSync(path);
  const execute = async (
    query: string,
    parameters: SqlValue[] = [],
  ): Promise<SqlResult> => {
    const statement = connection.prepare(query);
    if (query.trim().toUpperCase().startsWith('SELECT')) {
      return { rows: statement.all(...parameters) };
    }
    return { rows: [], rowsAffected: statement.run(...parameters).changes };
  };
  return {
    execute,
    async transaction(
      operation: (transaction: SqlTransaction) => Promise<void>,
    ) {
      connection.exec('BEGIN IMMEDIATE');
      const transaction: SqlTransaction = {
        execute,
        commit: () => ({ rows: [] }),
        rollback: () => ({ rows: [] }),
      };
      try {
        await operation(transaction);
        connection.exec('COMMIT');
      } catch (error) {
        connection.exec('ROLLBACK');
        throw error;
      }
    },
    closeAsync: async () => connection.close(),
  };
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

describe('SQLCipher-backed agent-memory deletion', () => {
  it('removes linked and unlinked memory through Rememori and persists after database reopen', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'orot-agent-memory-delete-'));
    const databasePath = join(directory, 'agent-memory.sqlite');
    let database = openDatabase(databasePath);
    try {
      await database.execute(
        'CREATE TABLE transcript_segments (id TEXT PRIMARY KEY NOT NULL, payload_json TEXT NOT NULL)',
      );
      const memory = await createAgentMemory({
        embedder,
        storage: new SqlCipherAgentMemoryStorage(database),
      });
      const linkedId = await memory.remember(linkedMemory);
      const unlinkedId = await memory.remember(unlinkedMemory);

      await expect(memory.forgetAll(['synthetic-source-2'])).resolves.toBe(2);
      await expect(memory.recall(linkedMemory.text)).resolves.toEqual([]);
      await expect(memory.recall(unlinkedMemory.text)).resolves.toEqual([]);
      await memory.close();
      await database.closeAsync?.();

      database = openDatabase(databasePath);
      const storage = new SqlCipherAgentMemoryStorage(database);
      const reopened = await createAgentMemory({ embedder, storage });
      await expect(storage.listRecords()).resolves.toEqual([]);
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
    const database = openDatabase(join(directory, 'agent-memory.sqlite'));
    try {
      await database.execute(
        'CREATE TABLE transcript_segments (id TEXT PRIMARY KEY NOT NULL, payload_json TEXT NOT NULL)',
      );
      const storage = new SqlCipherAgentMemoryStorage(database);
      const memory = await createAgentMemory({ embedder, storage });
      const linkedId = await memory.remember(linkedMemory);
      const unlinkedId = await memory.remember(unlinkedMemory);
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
