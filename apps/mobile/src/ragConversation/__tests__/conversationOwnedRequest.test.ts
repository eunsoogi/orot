import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationSessions } from '../conversationSessions';

test('owned completion returns only the durable answer for its actual request', async () => {
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
    const sender = jest.fn(async (question, _history, signal, observer) => {
      await observer!.onRetentionCandidate!(
        {
          question,
          answer: 'Saved answer',
          providerId: 'p',
          modelId: 'm',
          sources: [],
          citations: [],
        },
        signal!,
      );
      return {
        status: 'answer' as const,
        answer: 'Saved answer',
        citations: [],
      };
    });
    const handle = sessions.sendOwnedPrompt(1, 'Question', sender);
    const result = await handle.completion;
    expect(result).toEqual({
      status: 'completed',
      identity: {
        requestId: 'identity-2',
        sessionId: 'identity-1',
        messageId: 'identity-2',
        sessionVersion: 0,
      },
      answer: 'Saved answer',
    });
    expect(sender).toHaveBeenCalledTimes(1);
    expect(handle.cancel()).toBe(false);
    sessions.dispose();
  } finally {
    connection.close();
  }
});

test('a stale handle cannot cancel a later request in the same session', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  await runMigrations(connection.database);
  const storage = createConversationArtifactStorage(connection.database);
  let sequence = 0;
  const retention = createConversationSessionRetention({
    openStorage: async () => storage,
    createId: () => `identity-${++sequence}`,
    now: () => '2026-11-13T00:00:00.000Z',
  });
  const sessions = createConversationSessions({ retention });
  const first = sessions.sendOwnedPrompt(1, 'First', async () => ({
    status: 'failure',
    kind: 'provider_refused',
  }));
  expect(await first.completion).toEqual({
    status: 'failure',
    kind: 'provider_refused',
  });
  expect(await first.requestIdentity).toMatchObject({
    requestId: 'identity-2',
  });
  let signal: AbortSignal | undefined;
  let release!: () => void;
  let entered!: () => void;
  const ready = new Promise<void>(resolve => {
    entered = resolve;
  });
  const next = sessions.sendPrompt(
    1,
    'Second',
    async (_question, _history, current) => {
      signal = current;
      entered();
      await new Promise<void>(resolve => {
        release = resolve;
      });
      return { status: 'failure', kind: 'provider_refused' };
    },
  );
  await ready;
  expect(first.cancel()).toBe(false);
  expect(signal?.aborted).toBe(false);
  release();
  await next;
  sessions.dispose();
  connection.close();
});

test('a request without protected retention never reports a committed answer', async () => {
  const sessions = createConversationSessions();
  const handle = sessions.sendOwnedPrompt(1, 'Question', async () => ({
    status: 'answer',
    answer: 'unsaved',
    citations: [],
  }));
  expect(await handle.completion).toMatchObject({ status: 'failure' });
  sessions.dispose();
});

test('cancelling an owned request aborts only its controller', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const storage = createConversationArtifactStorage(connection.database);
    let sequence = 0;
    const sessions = createConversationSessions({
      retention: createConversationSessionRetention({
        openStorage: async () => storage,
        createId: () => `id-${++sequence}`,
        now: () => '2026-11-13T00:00:00.000Z',
      }),
    });
    let release!: () => void;
    let entered!: () => void;
    let signal: AbortSignal | undefined;
    const ready = new Promise<void>(resolve => {
      entered = resolve;
    });
    const handle = sessions.sendOwnedPrompt(
      1,
      'Question',
      async (_question, _history, current) => {
        signal = current;
        entered();
        await new Promise<void>(resolve => {
          release = resolve;
        });
        return { status: 'failure', kind: 'cancelled' };
      },
    );
    await ready;
    expect(handle.cancel()).toBe(true);
    expect(signal?.aborted).toBe(true);
    expect(handle.cancel()).toBe(false);
    release();
    expect(await handle.completion).toEqual({
      status: 'failure',
      kind: 'cancelled',
    });
    expect(await storage.listCompletionIdentities()).toEqual([]);
    sessions.dispose();
  } finally {
    connection.close();
  }
});

test('a hidden session cannot return an earlier committed answer', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const storage = createConversationArtifactStorage(connection.database);
    let sequence = 0;
    const sessions = createConversationSessions({
      retention: createConversationSessionRetention({
        openStorage: async () => storage,
        createId: () => `id-${++sequence}`,
        now: () => '2026-11-13T00:00:00.000Z',
      }),
    });
    const handle = sessions.sendOwnedPrompt(
      1,
      'Question',
      async (question, _history, signal, observer) => {
        await observer!.onRetentionCandidate!(
          {
            question,
            answer: 'stale',
            providerId: 'p',
            modelId: 'm',
            sources: [],
            citations: [],
          },
          signal!,
        );
        await storage.hideSession('id-1', 0);
        return { status: 'answer', answer: 'stale', citations: [] };
      },
    );
    expect(await handle.completion).toEqual({
      status: 'failure',
      kind: 'unavailable',
    });
    sessions.dispose();
  } finally {
    connection.close();
  }
});
