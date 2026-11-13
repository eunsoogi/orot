import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationSessions } from '../conversationSessions';

test('explicit Stop retains submitted text and partial output without resending or completion', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const storage = createConversationArtifactStorage(connection.database);
    let sequence = 0;
    const retention = createConversationSessionRetention({
      openStorage: async () => storage,
      createId: () => `id-${++sequence}`,
      now: () => '2026-11-13T00:00:00.000Z',
    });
    const sessions = createConversationSessions({ retention });
    sessions.setDraft(1, 'Question');
    let finish!: () => void;
    let ready!: () => void;
    const started = new Promise<void>(resolve => {
      ready = resolve;
    });
    const sender = jest.fn(async () => {
      ready();
      await new Promise<void>(resolve => {
        finish = resolve;
      });
      return { status: 'failure' as const, kind: 'cancelled' as const };
    });
    const pending = sessions.send(1, sender);
    await started;
    const lease = { requestId: 'id-2', sessionId: 'id-1', sessionVersion: 0 };
    const boundary = await storage.invalidatePreview(lease);
    expect(
      await storage.preparePreview(lease, boundary, {
        providerId: 'p',
        modelId: 'm',
        sources: [],
      }),
    ).toBe(true);
    expect(await storage.writePreview(lease, boundary, 'Partial')).toBe(true);
    sessions.cancel(1);
    finish();
    await pending;
    expect(await storage.listInterruptedRequests('id-1', 0)).toMatchObject([
      { id: 'id-2', question: 'Question' },
    ]);
    expect(await storage.readInterruptedPreview(lease)).toBe('Partial');
    expect(await storage.listCompletionIdentities()).toEqual([]);
    expect(sender).toHaveBeenCalledTimes(1);
    sessions.dispose();
  } finally {
    connection.close();
  }
});

test('Stop while the checkpoint is being written fences it after the write settles', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const storage = createConversationArtifactStorage(connection.database);
    let release!: () => void;
    let writing!: () => void;
    const started = new Promise<void>(resolve => {
      writing = resolve;
    });
    const delayed = {
      ...storage,
      startRequest: async (
        ...args: Parameters<typeof storage.startRequest>
      ) => {
        writing();
        await new Promise<void>(resolve => {
          release = resolve;
        });
        await storage.startRequest(...args);
      },
    };
    let sequence = 0;
    const retention = createConversationSessionRetention({
      openStorage: async () => delayed,
      createId: () => `id-${++sequence}`,
      now: () => '2026-11-13T00:00:00.000Z',
    });
    const sessions = createConversationSessions({ retention });
    const sender = jest.fn();
    sessions.setDraft(1, 'Question');
    const pending = sessions.send(1, sender);
    await started;
    sessions.cancel(1);
    release();
    await pending;
    expect(sender).not.toHaveBeenCalled();
    expect(await storage.listInterruptedRequests('id-1', 0)).toMatchObject([
      { id: 'id-2', question: 'Question' },
    ]);
    expect(await storage.listCompletionIdentities()).toEqual([]);
    sessions.dispose();
  } finally {
    connection.close();
  }
});
