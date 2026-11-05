import { runMigrations } from '@orot/storage';
import type { ConversationToolEvent } from '@orot/agent-runtime';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';

const { mkdtempSync, rmSync } = require('node:fs') as {
  mkdtempSync(prefix: string): string;
  rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
};
const { tmpdir } = require('node:os') as { tmpdir(): string };
const { join } = require('node:path') as { join(...parts: string[]): string };

const event: ConversationToolEvent = {
  version: 1,
  operationRunId: 'run',
  callId: 'tool-1',
  toolName: 'local_search',
  order: 1,
  status: 'started',
  inputSummary: { sourceKind: 'personal_record' },
  sources: [],
};
const createdAt = '2026-11-06T00:00:00.000Z';
const input = {
  sessionId: 'conversation',
  messageId: 'message',
  createdAt,
  sessionVersion: 0,
};

test('real SQLite close/reopen retains ordered parallel calls, retries and interruption without changing old sessions', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-conversation-events-'));
  let connection = openSqliteTestDatabase(join(directory, 'database.sqlite'));
  try {
    await runMigrations(connection.database);
    let storage = createConversationArtifactStorage(connection.database);
    const generation = await storage.currentGeneration();
    await storage.createSession('conversation', generation);
    await storage.createSession('legacy', generation);
    await storage.appendToolEvent({ ...input, event });
    await storage.appendToolEvent({
      ...input,
      event: {
        ...event,
        callId: 'parallel',
        order: 2,
        status: 'completed',
        resultSummary: { referenceCount: 1 },
        sources: [
          {
            sourceKind: 'personal_record',
            sourceId: 'source',
            sourceRevision: '1',
            evidenceId: 'span',
            evidenceRevision: '2',
          },
        ],
      },
    });
    await storage.appendToolEvent({
      ...input,
      event: { ...event, callId: 'parallel', order: 2 },
    });
    await storage.appendToolEvent({
      ...input,
      event: { ...event, operationRunId: 'retry', status: 'failed' },
    });
    expect((await storage.listSessions()).items[0]?.id).toBe('conversation');
    connection.close();
    connection = openSqliteTestDatabase(join(directory, 'database.sqlite'));
    storage = createConversationArtifactStorage(connection.database);
    await storage.recoverInterruptedToolEvents();
    await storage.recoverInterruptedToolEvents();
    const turns = await storage.readToolTurns('conversation');
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ messageId: 'message', createdAt });
    expect(
      turns[0]!.toolEvents.map(e => [e.operationRunId, e.callId, e.status]),
    ).toEqual([
      ['retry', 'tool-1', 'failed'],
      ['run', 'tool-1', 'interrupted'],
      ['run', 'parallel', 'completed'],
    ]);
    expect(turns[0]!.toolEvents[2]!.sources[0]?.evidenceId).toBe('span');
    expect(await storage.readToolTurns('legacy')).toEqual([]);
    expect(await storage.activeSessionVersion('legacy')).toBe(0);
  } finally {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('separate conversation and message identities are fenced, projected and removed with the session lease', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const storage = createConversationArtifactStorage(connection.database);
    const generation = await storage.currentGeneration();
    await storage.createSession('conversation', generation);
    await storage.createSession('other', generation);
    await storage.appendToolEvent({
      ...input,
      event: { ...event, secret: 'PRIVATE' } as ConversationToolEvent,
    });
    await storage.appendToolEvent({
      ...input,
      sessionId: 'other',
      event: { ...event, status: 'cancelled' },
    });
    await expect(
      storage.appendToolEvent({ ...input, messageId: 'wrong-message', event }),
    ).rejects.toThrow('different message');
    const rows = await connection.database.execute(
      'SELECT event_json FROM conversation_tool_events',
    );
    expect(JSON.stringify(rows)).not.toContain('PRIVATE');
    expect(
      (await storage.readToolTurns('conversation'))[0]?.toolEvents[0]?.status,
    ).toBe('started');
    expect(
      (await storage.readToolTurns('other'))[0]?.toolEvents[0]?.status,
    ).toBe('cancelled');
    await storage.hideSession('conversation', 0);
    expect(await storage.readToolTurns('conversation')).toEqual([]);
    await expect(storage.appendToolEvent({ ...input, event })).rejects.toThrow(
      'unavailable',
    );
    await storage.deleteSession('conversation');
    expect(
      (
        await connection.database.execute(
          'SELECT * FROM conversation_tool_events WHERE session_id = ?',
          ['conversation'],
        )
      ).rows,
    ).toEqual([]);
    expect(await storage.readToolTurns('other')).toHaveLength(1);
  } finally {
    connection.close();
  }
});

test('a late tool callback cannot recreate events for a deleted conversation turn', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const storage = createConversationArtifactStorage(connection.database);
    await storage.createSession(
      'conversation',
      await storage.currentGeneration(),
    );
    await storage.appendToolEvent({ ...input, event });
    await storage.append({
      id: input.messageId,
      sessionId: input.sessionId,
      createdAt,
      providerId: 'provider',
      modelId: 'model',
      status: 'complete',
      question: 'question',
      answer: 'answer',
      sources: [],
    });
    await connection.database.execute(
      'DELETE FROM conversation_artifacts WHERE id = ?',
      [input.messageId],
    );
    expect(await storage.readToolTurns(input.sessionId)).toEqual([]);
    await expect(
      storage.appendToolEvent({
        ...input,
        event: { ...event, status: 'completed' },
      }),
    ).rejects.toThrow();
    expect(await storage.readToolTurns(input.sessionId)).toEqual([]);
  } finally {
    connection.close();
  }
});
