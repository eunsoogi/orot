import { createDailyReportIdentity } from '@orot/domain';
import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationSessions } from '../conversationSessions';

test('a saved task is discovered and restored without switching the current draft or starting generation', async () => {
  const { mkdtempSync, rmSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const directory = mkdtempSync(join(tmpdir(), 'orot-task-history-'));
  const path = join(directory, 'database.sqlite');
  let connection = openSqliteTestDatabase(path);
  const identity = createDailyReportIdentity('2026-11-10', 'Asia/Seoul');
  try {
    await runMigrations(connection.database);
    let storage = createConversationArtifactStorage(connection.database);
    const makeStore = () => {
      const retention = createConversationSessionRetention({
        openStorage: async () => storage,
        createId: () => 'durable-session',
        now: () => '2026-11-10T03:00:00.000Z',
      });
      return createConversationSessions({
        retention,
        listSessions: cursor => storage.listSessions(cursor),
        restoreSession: async () => [],
        restoreTasks: async id =>
          storage.readTaskCards(id, (await storage.activeSessionVersion(id))!),
      });
    };
    const original = makeStore();
    await original.saveTaskCard(1, 'report-task', {
      kind: 'daily_report',
      identity,
    });
    original.dispose();
    connection.close();
    connection = openSqliteTestDatabase(path);
    storage = createConversationArtifactStorage(connection.database);
    const restored = makeStore();
    restored.setDraft(1, 'keep this draft');
    await restored.loadHistory();
    const snapshot = restored.getSnapshot();
    expect(snapshot.activeId).toBe(1);
    expect(snapshot.sessions[0]?.draft).toBe('keep this draft');
    expect(snapshot.sessions[1]?.taskCards).toEqual([
      expect.objectContaining({
        id: 'report-task',
        revision: 1,
        task: { kind: 'daily_report', identity },
      }),
    ]);
    await restored.loadHistory();
    expect(restored.getSnapshot().sessions).toHaveLength(2);
    restored.dispose();
  } finally {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('clearing conversation state while history discovery waits cannot attach the old session', async () => {
  let release!: (page: {
    items: { id: string; version: number; updatedAt: string }[];
    nextCursor: null;
  }) => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => {
    entered = resolve;
  });
  const attachExisting = jest.fn();
  const retention = {
    attachExisting,
    activeIdentity: () => null,
    activeLease: () => null,
    beginTurn: jest.fn(),
    invalidate: jest.fn(),
  } as never;
  const listSessions = jest
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          release = resolve;
          entered();
        }),
    )
    .mockResolvedValue({ items: [], nextCursor: null });
  const sessions = createConversationSessions({
    retention,
    restoreSession: async () => [],
    listSessions,
  });
  const pending = sessions.loadHistory();
  await started;
  sessions.invalidateAll();
  await sessions.loadHistory();
  expect(listSessions).toHaveBeenCalledTimes(2);
  release({
    items: [{ id: 'old', version: 0, updatedAt: '2026-11-10T03:00:00.000Z' }],
    nextCursor: null,
  });
  await pending;
  expect(attachExisting).not.toHaveBeenCalled();
  expect(sessions.getSnapshot().sessions).toHaveLength(1);
  sessions.dispose();
});

test('an uncertain committed task write can be retried without duplicating its card', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const storage = createConversationArtifactStorage(connection.database);
    const retention = createConversationSessionRetention({
      openStorage: async () => storage,
      createId: () => 'session',
      now: () => '2026-11-10T03:00:00.000Z',
    });
    let uncertain = true;
    const wrapped = {
      ...retention,
      async saveTaskCard(...args: Parameters<typeof retention.saveTaskCard>) {
        const result = await retention.saveTaskCard(...args);
        if (uncertain) {
          uncertain = false;
          throw new Error('commit acknowledgement lost');
        }
        return result;
      },
    };
    const sessions = createConversationSessions({ retention: wrapped });
    const task = {
      kind: 'daily_report' as const,
      identity: createDailyReportIdentity('2026-11-10', 'Asia/Seoul'),
    };
    await expect(sessions.saveTaskCard(1, 'card', task)).rejects.toThrow(
      'acknowledgement',
    );
    await sessions.saveTaskCard(1, 'card', task);
    expect(sessions.getSnapshot().sessions[0]?.taskCards).toEqual([
      expect.objectContaining({ id: 'card', revision: 1, task }),
    ]);
    expect(await storage.readTaskCards('session', 0)).toHaveLength(1);
    uncertain = true;
    const updated = {
      ...task,
      report: { identity: task.identity, runId: 'synthetic-run', revision: 2 },
    };
    await expect(sessions.saveTaskCard(1, 'card', updated)).rejects.toThrow(
      'acknowledgement',
    );
    await sessions.saveTaskCard(1, 'card', updated);
    expect((await storage.readTaskCards('session', 0))[0]).toMatchObject({
      revision: 2,
      task: updated,
    });
    sessions.dispose();
  } finally {
    connection.close();
  }
});

test('cancellation while adopting a committed treatment card cannot report success', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const storage = createConversationArtifactStorage(connection.database);
    const generation = await storage.currentGeneration();
    await storage.createSession('session', generation);
    await connection.database.execute(
      'INSERT INTO conversation_artifacts (id, session_id, created_at, result_json) VALUES (?, ?, ?, ?)',
      [
        'artifact',
        'session',
        '2026-11-10T03:00:00.000Z',
        JSON.stringify({ treatmentContext: {} }),
      ],
    );
    await storage.writeTaskCard({
      sessionId: 'session',
      sessionVersion: 0,
      id: 'treatment:artifact',
      createdAt: '2026-11-10T03:00:00.000Z',
      expectedRevision: null,
      task: { kind: 'treatment', artifactId: 'artifact' },
    });
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>(resolve => {
      release = resolve;
    });
    const started = new Promise<void>(resolve => {
      entered = resolve;
    });
    const retention = createConversationSessionRetention({
      openStorage: async () => ({
        ...storage,
        async readTaskCards(...args) {
          const value = await storage.readTaskCards(...args);
          entered();
          await waiting;
          return value;
        },
      }),
      createId: () => 'unused',
      now: () => '2026-11-10T03:00:00.000Z',
    });
    await retention.attachExisting(1, 'session', 0);
    const controller = new AbortController();
    const pending = retention.saveTaskCard(
      1,
      {
        id: 'treatment:artifact',
        createdAt: '2026-11-10T03:00:00.000Z',
        expectedRevision: null,
        task: { kind: 'treatment', artifactId: 'artifact' },
      },
      controller.signal,
    );
    await started;
    controller.abort();
    release();
    await expect(pending).rejects.toThrow('cancelled');
  } finally {
    connection.close();
  }
});
