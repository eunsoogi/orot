import { createConversationSessions } from '../conversationSessions';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';

test('removal aborts a held retry and prevents it from restoring a deleted output', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const entered = new Promise<void>(resolve => {
      started = resolve;
    });
    let attempts = 0;
    let sequence = 0;
    const retention = createConversationSessionRetention({
      openStorage: async () => ({
        ...storage,
        async append(...args) {
          if (++attempts === 1) throw new Error('write failed');
          started();
          await gate;
          await storage.append(...args);
        },
      }),
      createId: () => `id-${++sequence}`,
      now: () => '2026-10-05T00:00:00.000Z',
    });
    const store = createConversationSessions({
      retention,
      restoreSession: async () => [],
    });
    store.setDraft(1, 'question');
    await store.send(1, async (_question, _history, signal, observer) => {
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
      return { status: 'answer', answer: 'answer', citations: [] };
    });
    const retry = store.retrySave(1);
    await entered;
    await store.remove(1);
    await store.undoRemove();
    release();
    await retry;
    expect(await storage.read('id-2')).toBeNull();
    expect(
      store.getSnapshot().sessions.find(item => item.id === 1)?.retryingSave,
    ).toBe(false);
    expect(
      store.getSnapshot().sessions.find(item => item.id === 1)?.messages,
    ).toEqual([]);
  } finally {
    f.close();
  }
});

test('removal revokes a held save so undo cannot receive its late UI completion', async () => {
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
    const store = createConversationSessions({
      retention,
      restoreSession: async () => {
        const turn = await storage.read('id-2');
        return turn
          ? [{ question: turn.question, answer: turn.answer, citations: [] }]
          : [];
      },
    });
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
    await store.remove(1);
    expect(await storage.read('id-2')).toBeNull();
    await store.undoRemove();
    release();
    await running;
    expect(
      store
        .getSnapshot()
        .sessions.find(item => item.id === 1)
        ?.messages.map(item => item.content),
    ).toEqual(['question', 'answer']);
  } finally {
    f.close();
  }
});

test('a failed undo read stays retryable without reviving the cached answer', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    let sequence = 0;
    let reads = 0;
    const retention = createConversationSessionRetention({
      openStorage: async () => storage,
      createId: () => `id-${++sequence}`,
      now: () => '2026-10-05T00:00:00.000Z',
    });
    const store = createConversationSessions({
      retention,
      restoreSession: async () => {
        if (++reads === 1) throw new Error('temporarily unavailable');
        const turn = await storage.read('id-2');
        return turn
          ? [{ question: turn.question, answer: turn.answer, citations: [] }]
          : [];
      },
    });
    store.setDraft(1, 'question');
    await store.send(1, async (_question, _history, signal, observer) => {
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
    });
    await store.remove(1);
    await store.undoRemove();
    expect(
      store.getSnapshot().sessions.find(item => item.id === 1)?.messages,
    ).toEqual([]);
    expect(
      store.getSnapshot().sessions.find(item => item.id === 1)?.restoreFailed,
    ).toBe(true);
    await store.retryRestore(1);
    expect(
      store
        .getSnapshot()
        .sessions.find(item => item.id === 1)
        ?.messages.map(item => item.content),
    ).toEqual(['question', 'answer']);
  } finally {
    f.close();
  }
});
