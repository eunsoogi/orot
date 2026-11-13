import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationSessions } from '../conversationSessions';

async function setup() {
  const connection = openSqliteTestDatabase(':memory:');
  await runMigrations(connection.database);
  const storage = createConversationArtifactStorage(connection.database);
  let sequence = 0;
  const retention = createConversationSessionRetention({
    openStorage: async () => storage,
    createId: () => `id-${++sequence}`,
    now: () => '2026-11-13T00:00:00.000Z',
  });
  return {
    connection,
    storage,
    sessions: createConversationSessions({ retention }),
  };
}

test('a rejected busy handle cannot cancel the already running request', async () => {
  const { connection, sessions } = await setup();
  try {
    let entered!: () => void;
    let release!: () => void;
    let signal: AbortSignal | undefined;
    const ready = new Promise<void>(resolve => {
      entered = resolve;
    });
    const running = sessions.sendPrompt(
      1,
      'First',
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
    const rejected = sessions.sendOwnedPrompt(1, 'Second', async () => ({
      status: 'unavailable',
    }));
    expect(await rejected.completion).toEqual({
      status: 'failure',
      kind: 'not_started',
    });
    expect(await rejected.requestIdentity).toBeNull();
    expect(rejected.cancel()).toBe(false);
    expect(signal?.aborted).toBe(false);
    release();
    await running;
  } finally {
    sessions.dispose();
    connection.close();
  }
});

test('an answer returned without a durable completion is not delivered', async () => {
  const { connection, sessions, storage } = await setup();
  try {
    const handle = sessions.sendOwnedPrompt(1, 'Question', async () => ({
      status: 'answer',
      answer: 'not saved',
      citations: [],
    }));
    expect(await handle.completion).toEqual({
      status: 'failure',
      kind: 'unavailable',
    });
    expect(await storage.listCompletionIdentities()).toEqual([]);
  } finally {
    sessions.dispose();
    connection.close();
  }
});

test('a completed protected commit wins when cancellation arrives afterward', async () => {
  const { connection, sessions } = await setup();
  try {
    let committed!: () => void;
    let release!: () => void;
    const ready = new Promise<void>(resolve => {
      committed = resolve;
    });
    const handle = sessions.sendOwnedPrompt(
      1,
      'Question',
      async (question, _history, signal, observer) => {
        await observer!.onRetentionCandidate!(
          {
            question,
            answer: 'committed',
            providerId: 'p',
            modelId: 'm',
            sources: [],
            citations: [],
          },
          signal!,
        );
        committed();
        await new Promise<void>(resolve => {
          release = resolve;
        });
        return { status: 'answer', answer: 'committed', citations: [] };
      },
    );
    await ready;
    expect(handle.cancel()).toBe(true);
    release();
    expect(await handle.completion).toMatchObject({
      status: 'completed',
      answer: 'committed',
      identity: { requestId: 'id-2' },
    });
  } finally {
    sessions.dispose();
    connection.close();
  }
});

test('cancellation during commit acknowledgement still returns the committed answer', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const storage = createConversationArtifactStorage(connection.database);
    let committed!: () => void;
    let release!: () => void;
    const ready = new Promise<void>(resolve => {
      committed = resolve;
    });
    const delayedStorage = {
      ...storage,
      async append(...args: Parameters<typeof storage.append>) {
        await storage.append(...args);
        committed();
        await new Promise<void>(resolve => {
          release = resolve;
        });
      },
    };
    let sequence = 0;
    const sessions = createConversationSessions({
      retention: createConversationSessionRetention({
        openStorage: async () => delayedStorage,
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
            answer: 'committed',
            providerId: 'p',
            modelId: 'm',
            sources: [],
            citations: [],
          },
          signal!,
        );
        return { status: 'answer', answer: 'committed', citations: [] };
      },
    );
    await ready;
    expect(handle.cancel()).toBe(true);
    release();
    expect(await handle.completion).toMatchObject({
      status: 'completed',
      answer: 'committed',
      identity: { requestId: 'id-2' },
    });
    sessions.dispose();
  } finally {
    connection.close();
  }
});
