import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationSessions } from '../conversationSessions';
import type {
  ConversationExecutionAdapter,
  ConversationExecutionEvent,
} from '../conversationExecutionLease';

test('the protected request exists before transmission and completion follows answer commit', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const storage = createConversationArtifactStorage(connection.database);
    let sequence = 0;
    const retention = createConversationSessionRetention({
      openStorage: async () => storage,
      createId: () => `identity-${++sequence}`,
      now: () => '2026-11-13T00:00:00.000Z',
    });
    const sessions = createConversationSessions({ retention });
    sessions.setDraft(1, 'Synthetic question');
    await sessions.send(1, async (question, _history, signal, observer) => {
      const rows = await connection.database.execute(
        'SELECT question, status FROM conversation_requests WHERE id = ?',
        ['identity-2'],
      );
      expect(rows.rows).toEqual([
        { question: 'Synthetic question', status: 'active' },
      ]);
      expect(await storage.listCompletionIdentities()).toEqual([]);
      await observer!.onRetentionCandidate!(
        {
          question,
          answer: 'Synthetic answer',
          providerId: 'provider',
          modelId: 'model',
          sources: [],
          citations: [],
        },
        signal!,
      );
      return { status: 'answer', answer: 'Synthetic answer', citations: [] };
    });
    expect(await storage.listCompletionIdentities()).toMatchObject([
      {
        sessionId: 'identity-1',
        requestId: 'identity-2',
        messageId: 'identity-2',
      },
    ]);
    sessions.dispose();
  } finally {
    connection.close();
  }
});

test('execution expiry interrupts only its request without resubmitting', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const storage = createConversationArtifactStorage(connection.database);
    let sequence = 0;
    const retention = createConversationSessionRetention({
      openStorage: async () => storage,
      createId: () => `identity-${++sequence}`,
      now: () => '2026-11-13T00:00:00.000Z',
    });
    let listener: (event: ConversationExecutionEvent) => void = () => {};
    const execution: ConversationExecutionAdapter = {
      begin: jest.fn().mockResolvedValue(true),
      isActive: jest.fn().mockResolvedValue(true),
      protectedDataAvailable: jest.fn().mockResolvedValue(true),
      end: jest.fn(),
      subscribe: value => {
        listener = value;
        return () => {};
      },
    };
    const sessions = createConversationSessions({ retention, execution });
    sessions.setDraft(1, 'Synthetic question');
    let signal: AbortSignal | undefined;
    let finish!: () => void;
    let started!: () => void;
    const ready = new Promise<void>(resolve => {
      started = resolve;
    });
    const sender = jest.fn(async (_question, _history, current) => {
      signal = current;
      started();
      await new Promise<void>(resolve => {
        finish = resolve;
      });
      return { status: 'failure' as const, kind: 'cancelled' as const };
    });
    const pending = sessions.send(1, sender);
    await ready;
    const leaseId = (execution.begin as jest.Mock).mock.calls[0]![0];
    expect(leaseId).toBe('identity-2:lease:1:1');
    listener({ kind: 'expired', requestId: 'identity-2' });
    expect(signal?.aborted).toBe(false);
    listener({ kind: 'expired', requestId: leaseId });
    expect(signal?.aborted).toBe(true);
    finish();
    await pending;
    expect(sender).toHaveBeenCalledTimes(1);
    expect(sessions.getSnapshot().sessions[0]?.busy).toBe(false);
    expect(
      await storage.listInterruptedRequests('identity-1', 0),
    ).toMatchObject([{ id: 'identity-2' }]);
    expect(await storage.listCompletionIdentities()).toEqual([]);
    sessions.dispose();
  } finally {
    connection.close();
  }
});

test('a failed protected checkpoint stops before provider transmission', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const storage = createConversationArtifactStorage(connection.database);
    await storage.currentGeneration();
    await connection.database.execute(
      "CREATE TRIGGER fail_request BEFORE INSERT ON conversation_requests BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END",
    );
    let sequence = 0;
    const retention = createConversationSessionRetention({
      openStorage: async () => storage,
      createId: () => `identity-${++sequence}`,
      now: () => '2026-11-13T00:00:00.000Z',
    });
    const sessions = createConversationSessions({ retention });
    const sender = jest.fn();
    sessions.setDraft(1, 'Synthetic question');
    await sessions.send(1, sender);
    expect(sender).not.toHaveBeenCalled();
    expect(sessions.getSnapshot().sessions[0]).toMatchObject({
      busy: false,
      draft: 'Synthetic question',
    });
    expect(await storage.listCompletionIdentities()).toEqual([]);
    sessions.dispose();
  } finally {
    connection.close();
  }
});
