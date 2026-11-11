import { createDailyReportIdentity } from '@orot/domain';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import { deleteSavedTreatment } from '../../treatmentContext/treatmentSavedLibrary';

const identity = createDailyReportIdentity('2026-11-10', 'Asia/Seoul');
const createdAt = '2026-11-10T03:00:00.000Z';
const task = { kind: 'daily_report' as const, identity };

test('task cards survive SQLite reopening, use revision checks, and follow session deletion', async () => {
  const { mkdtempSync, rmSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const directory = mkdtempSync(join(tmpdir(), 'orot-task-cards-'));
  const path = join(directory, 'database.sqlite');
  let connection = openSqliteTestDatabase(path);
  try {
    await runMigrations(connection.database);
    let storage = createConversationArtifactStorage(connection.database);
    await storage.createSession('session', await storage.currentGeneration());
    await storage.writeTaskCard({
      sessionId: 'session',
      sessionVersion: 0,
      id: 'task',
      createdAt,
      expectedRevision: null,
      task,
    });
    expect((await storage.listSessions()).items.map(item => item.id)).toEqual([
      'session',
    ]);
    connection.close();
    connection = openSqliteTestDatabase(path);
    storage = createConversationArtifactStorage(connection.database);
    expect(await storage.readTaskCards('session', 0)).toEqual([
      { id: 'task', createdAt, revision: 1, task },
    ]);
    const saved = { ...task, report: { identity, runId: 'run', revision: 2 } };
    await storage.writeTaskCard({
      sessionId: 'session',
      sessionVersion: 0,
      id: 'task',
      createdAt,
      expectedRevision: 1,
      task: saved,
    });
    await expect(
      storage.writeTaskCard({
        sessionId: 'session',
        sessionVersion: 0,
        id: 'task',
        createdAt,
        expectedRevision: 1,
        task,
      }),
    ).rejects.toThrow();
    expect((await storage.readTaskCards('session', 0))[0]).toMatchObject({
      revision: 2,
      task: saved,
    });
    const hidden = await storage.hideSession('session', 0);
    await expect(
      storage.writeTaskCard({
        sessionId: 'session',
        sessionVersion: 0,
        id: 'task',
        createdAt,
        expectedRevision: 2,
        task,
      }),
    ).rejects.toThrow();
    await expect(storage.readTaskCards('session', 0)).rejects.toThrow();
    const version = await storage.undoHiddenSession('session', hidden!);
    expect(await storage.readTaskCards('session', version)).toHaveLength(1);
    await storage.deleteSession('session');
    expect(
      (
        await connection.database.execute(
          'SELECT * FROM conversation_task_cards',
        )
      ).rows,
    ).toHaveLength(0);
  } finally {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('task storage rejects malformed or untracked personal content and cancelled writes', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const storage = createConversationArtifactStorage(connection.database);
    await storage.createSession('session', await storage.currentGeneration());
    const base = {
      sessionId: 'session',
      sessionVersion: 0,
      id: 'task',
      createdAt,
      expectedRevision: null,
    };
    await expect(
      storage.writeTaskCard({
        ...base,
        task: { ...task, privateText: 'private' } as never,
      }),
    ).rejects.toThrow();
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      storage.writeTaskCard({ ...base, task, signal: cancelled.signal }),
    ).rejects.toThrow();
    expect(await storage.readTaskCards('session', 0)).toEqual([]);
  } finally {
    connection.close();
  }
});

test('a treatment card can only reference its own retained artifact and follows its deletion', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const storage = createConversationArtifactStorage(connection.database);
    const generation = await storage.currentGeneration();
    await storage.createSession('owner', generation);
    await storage.createSession('other', generation);
    await connection.database.execute(
      'INSERT INTO conversation_artifacts (id, session_id, created_at, result_json) VALUES (?, ?, ?, ?)',
      [
        'artifact',
        'owner',
        createdAt,
        JSON.stringify({ treatmentContext: {} }),
      ],
    );
    const input = {
      sessionVersion: 0,
      id: 'card',
      createdAt,
      expectedRevision: null,
      task: { kind: 'treatment' as const, artifactId: 'artifact' },
    };
    await expect(
      storage.writeTaskCard({ ...input, sessionId: 'other' }),
    ).rejects.toThrow();
    await storage.writeTaskCard({ ...input, sessionId: 'owner' });
    expect(await storage.readTaskCards('owner', 0)).toHaveLength(1);
    await expect(
      deleteSavedTreatment(
        connection.database,
        { id: 'artifact', sessionId: 'owner', createdAt },
        { id: 'owner', version: 9 },
      ),
    ).rejects.toThrow();
    expect(await storage.readTaskCards('owner', 0)).toHaveLength(1);
    await connection.database.execute(
      'DELETE FROM conversation_artifacts WHERE id = ?',
      ['artifact'],
    );
    expect(await storage.readTaskCards('owner', 0)).toEqual([]);
  } finally {
    connection.close();
  }
});

test('damaged card metadata is withheld during restoration', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const storage = createConversationArtifactStorage(connection.database);
    await storage.createSession('session', await storage.currentGeneration());
    await connection.database.execute(
      'INSERT INTO conversation_task_cards VALUES (?, ?, ?, ?, ?)',
      ['session', 'broken', 'not-a-date', 1, JSON.stringify(task)],
    );
    await expect(storage.readTaskCards('session', 0)).rejects.toThrow(
      'Invalid retained task card',
    );
  } finally {
    connection.close();
  }
});

test('clearing all local data removes cards and prevents a late write from reviving them', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const storage = createConversationArtifactStorage(connection.database);
    await storage.createSession('session', await storage.currentGeneration());
    const input = {
      sessionId: 'session',
      sessionVersion: 0,
      id: 'task',
      createdAt,
      expectedRevision: null,
      task,
    };
    await storage.writeTaskCard(input);
    await createRecordRepository(connection.database).deleteAllLocalData();
    expect(
      (
        await connection.database.execute(
          'SELECT * FROM conversation_task_cards',
        )
      ).rows,
    ).toEqual([]);
    await expect(storage.writeTaskCard(input)).rejects.toThrow('unavailable');
    await expect(storage.readTaskCards('session', 0)).rejects.toThrow(
      'unavailable',
    );
  } finally {
    connection.close();
  }
});
