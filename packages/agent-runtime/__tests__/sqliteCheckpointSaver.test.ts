import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph/web';
import type { SqlDatabase } from '../../storage/src/sql';
import { createLangGraphCheckpointStorage } from '../../storage/src/checkpointStorage';
import { openSqliteTestDatabase } from '../../storage/__tests__/sqliteTestDatabase';
import { createStatefulTwoNodeGraph, SqliteCheckpointSaver } from '../src';

function createCheckpointConfig(threadId: string) {
  return { configurable: { thread_id: threadId, checkpoint_ns: '' } };
}

describe('SqliteCheckpointSaver', () => {
  it('resumes a completed node after closing and reopening the database', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'orot-checkpoint-resume-'));
    const path = join(directory, 'checkpoints.sqlite');
    const config = createCheckpointConfig('visit-questions:thread-42');
    let opened = openSqliteTestDatabase(path);
    try {
      const firstGraph = createStatefulTwoNodeGraph({
        checkpointer: new SqliteCheckpointSaver(
          createLangGraphCheckpointStorage(opened.database),
        ),
        interruptAfter: ['increment'],
      });
      await expect(firstGraph.invoke({ value: 3 }, config)).resolves.toMatchObject({
        value: 4,
        nodeRuns: ['increment'],
      });
      opened.close();

      opened = openSqliteTestDatabase(path);
      const resumedGraph = createStatefulTwoNodeGraph({
        checkpointer: new SqliteCheckpointSaver(
          createLangGraphCheckpointStorage(opened.database),
        ),
      });
      await expect(resumedGraph.invoke(null, config)).resolves.toMatchObject({
        value: 8,
        nodeRuns: ['increment', 'double'],
      });
    } finally {
      opened.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('replays an incomplete node but applies its local effect once with a stable key', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'orot-checkpoint-replay-'));
    const path = join(directory, 'checkpoints.sqlite');
    const opened = openSqliteTestDatabase(path);
    try {
      const activeDatabase = opened.database;
      await activeDatabase.execute(
        'CREATE TABLE checkpoint_node_attempts (id INTEGER PRIMARY KEY, operation_key TEXT NOT NULL)',
      );
      await activeDatabase.execute(
        'CREATE TABLE checkpoint_effects (operation_key TEXT PRIMARY KEY)',
      );
      const saver = new SqliteCheckpointSaver(
        createLangGraphCheckpointStorage(activeDatabase),
      );
      const State = Annotation.Root({ confirmed: Annotation<boolean>() });
      const retriedGraph = new StateGraph(State)
        .addNode('confirm', async () => {
          const attempts = await recordNodeAttempt(activeDatabase, 'visit-question:thread-43:confirm');
          await activeDatabase.execute(
            'INSERT OR IGNORE INTO checkpoint_effects (operation_key) VALUES (?)',
            ['visit-question:thread-43:confirm'],
          );
          if (attempts === 1) throw new Error('simulated failure after the durable effect');
          return { confirmed: true };
        }, { retryPolicy: { maxAttempts: 2, initialInterval: 0 } })
        .addEdge(START, 'confirm')
        .addEdge('confirm', END)
        .compile({ checkpointer: saver });

      await expect(retriedGraph.invoke({ confirmed: false }, createCheckpointConfig('visit-questions:thread-43')))
        .resolves.toMatchObject({ confirmed: true });
      expect(await countRows(activeDatabase, 'checkpoint_node_attempts')).toBe(2);
      expect(await countRows(activeDatabase, 'checkpoint_effects')).toBe(1);
    } finally {
      opened.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('updates reserved writes independently when an ordinary write shares the batch', async () => {
    const saved: Array<{ index: number; channel: string; replaceExisting: boolean }> = [];
    const storage: ConstructorParameters<typeof SqliteCheckpointSaver>[0] = {
      ensureSchema: async () => undefined,
      saveCheckpoint: async () => undefined,
      saveWrites: async (_threadId, _namespace, _checkpointId, writes) => {
        saved.push(...writes);
      },
      loadCheckpoint: async () => undefined,
      listCheckpoints: async () => [],
      deleteThread: async () => undefined,
    };
    const saver = new SqliteCheckpointSaver(storage);
    const config = { configurable: { thread_id: 'workflow:thread', checkpoint_id: 'cp-1' } };

    await saver.putWrites(config, [
      ['__interrupt__', 'first'],
      ['result', 'first'],
    ], 'task-1');
    await saver.putWrites(config, [
      ['__interrupt__', 'second'],
      ['result', 'second'],
    ], 'task-1');

    expect(saved.map(({ channel, index, replaceExisting }) => [channel, index, replaceExisting]))
      .toEqual([
        ['__interrupt__', -3, true],
        ['result', 1, false],
        ['__interrupt__', -3, true],
        ['result', 1, false],
      ]);
  });
});

async function recordNodeAttempt(database: SqlDatabase, operationKey: string): Promise<number> {
  await database.execute(
    'INSERT INTO checkpoint_node_attempts (operation_key) VALUES (?)',
    [operationKey],
  );
  const result = await database.execute(
    'SELECT count(*) AS count FROM checkpoint_node_attempts WHERE operation_key = ?',
    [operationKey],
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function countRows(database: SqlDatabase, table: string): Promise<number> {
  const result = await database.execute(`SELECT count(*) AS count FROM ${table}`);
  return Number(result.rows[0]?.count ?? 0);
}
