import { createConversationSessions } from '../conversationSessions';
import type { ConversationSender } from '../conversationSessions';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';

test('a committed answer remains visible when stop arrives while its save is settling', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    let release!: () => void;
    let saved!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const committed = new Promise<void>(resolve => {
      saved = resolve;
    });
    let sequence = 0;
    const retention = createConversationSessionRetention({
      openStorage: async () => ({
        ...storage,
        async append(...args) {
          await storage.append(...args);
          saved();
          await gate;
        },
      }),
      createId: () => `id-${++sequence}`,
      now: () => '2026-10-05T00:00:00.000Z',
    });
    const store = createConversationSessions({ retention });
    store.setDraft(1, 'question');
    const running = store.send(
      1,
      async (_question, _history, signal, observer) => {
        await observer!.onRetentionCandidate!(
          {
            question: 'question',
            answer: 'answer',
            providerId: 'provider',
            modelId: 'model',
            sources: f.saved.sources,
            citations: [f.saved.sources[0]!.reference],
          },
          signal!,
        );
        return { status: 'answer', answer: 'answer', citations: [] };
      },
    );
    await committed;
    store.cancel(1);
    release();
    await running;
    expect(
      store.getSnapshot().sessions[0]?.messages.map(item => item.content),
    ).toEqual(['question', 'answer']);
    expect(await storage.read('id-2')).not.toBeNull();
  } finally {
    f.close();
  }
});

test('a failed write is visible and retries the same answer without calling the model again', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    let first = true;
    let sequence = 0;
    const retention = createConversationSessionRetention({
      openStorage: async () => ({
        ...storage,
        async append(...args) {
          if (first) {
            first = false;
            throw new Error('write failed');
          }
          return storage.append(...args);
        },
      }),
      createId: () => `id-${++sequence}`,
      now: () => '2026-10-05T00:00:00.000Z',
    });
    const store = createConversationSessions({
      retention,
      restoreSession: async () => {
        const turn = await storage.read('id-2');
        return turn
          ? [{ question: turn.question, answer: turn.answer, citations: [] }]
          : [];
      },
    });
    const sender: ConversationSender = jest.fn(
      async (_question, _history, signal, observer) => {
        try {
          await observer!.onRetentionCandidate!(
            {
              question: 'question',
              answer: 'answer',
              providerId: 'provider',
              modelId: 'model',
              sources: f.saved.sources,
              citations: [f.saved.sources[0]!.reference],
            },
            signal!,
          );
        } catch {
          observer!.onRetentionFailure!();
        }
        return { status: 'answer' as const, answer: 'answer', citations: [] };
      },
    );
    store.setDraft(1, 'question');
    await store.send(1, sender);
    expect(store.getSnapshot().sessions[0]?.unsavedCount).toBe(1);
    expect(await storage.read('id-2')).toBeNull();
    store.setDraft(1, 'later question');
    await store.send(1, async () => ({ status: 'no_evidence' }));
    const beforeRetry = store.getSnapshot().sessions[0]!.messages;
    await store.retrySave(1);
    expect(store.getSnapshot().sessions[0]?.unsavedCount).toBe(0);
    expect((await storage.read('id-2'))?.answer).toBe('answer');
    expect(sender).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().sessions[0]?.messages).toEqual(beforeRetry);
  } finally {
    f.close();
  }
});

test('a queued send after disposal neither calls the model nor creates a durable session', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    let sequence = 0;
    const retention = createConversationSessionRetention({
      openStorage: async () => storage,
      createId: () => `id-${++sequence}`,
      now: () => '2026-10-05T00:00:00.000Z',
    });
    const store = createConversationSessions({ retention });
    const sender = jest.fn(async () => ({ status: 'no_evidence' as const }));
    store.setDraft(1, 'question');
    store.dispose();
    await store.send(1, sender);
    expect(sender).not.toHaveBeenCalled();
    expect(await storage.activeSessionVersion('id-1')).toBeNull();
  } finally {
    f.close();
  }
});
