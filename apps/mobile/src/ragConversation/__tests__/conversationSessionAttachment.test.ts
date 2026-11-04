import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationSessions } from '../conversationSessions';

test('a saved session can be attached without losing the current draft or generating another answer', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    await storage.createSession('saved', await storage.currentGeneration());
    await storage.append({
      id: 'turn',
      sessionId: 'saved',
      createdAt: '2026-10-05T00:00:00.000Z',
      providerId: 'provider',
      modelId: 'model',
      status: 'complete',
      question: 'saved question',
      answer: 'saved answer',
      sources: f.saved.sources,
      citations: [f.saved.sources[0]!.reference],
    });
    const retention = createConversationSessionRetention({
      openStorage: async () => storage,
      createId: () => 'new-turn',
      now: () => '2026-10-05T00:00:00.000Z',
    });
    const store = createConversationSessions({
      retention,
      restoreSession: async id =>
        Promise.all(
          (await storage.list(id)).items.map(async item => {
            const saved = (await storage.read(item.id))!;
            return {
              question: saved.question,
              answer: saved.answer,
              citations: saved.citations ?? [],
            };
          }),
        ),
    });
    store.setDraft(1, 'unfinished draft');
    const id = await store.attachExisting(
      'saved',
      0,
      '2026-10-05T00:00:00.000Z',
    );
    expect(
      store.getSnapshot().sessions.find(item => item.id === 1)?.draft,
    ).toBe('unfinished draft');
    expect(
      store
        .getSnapshot()
        .sessions.find(item => item.id === id)
        ?.messages.map(item => item.content),
    ).toEqual(['saved question', 'saved answer']);
    await expect(
      store.attachExisting('saved', 0, '2026-10-05T00:00:00.000Z'),
    ).rejects.toThrow();
    store.dispose();
  } finally {
    f.close();
  }
});

test.each(['clear', 'dispose'] as const)(
  '%s during attachment cannot restore an old session',
  async action => {
    const f = await healthContextFixture();
    try {
      const storage = createConversationArtifactStorage(f.database);
      await storage.createSession('saved', await storage.currentGeneration());
      let entered!: () => void;
      let release!: () => void;
      const reading = new Promise<void>(resolve => {
        entered = resolve;
      });
      const gate = new Promise<void>(resolve => {
        release = resolve;
      });
      const retention = createConversationSessionRetention({
        openStorage: async () => ({
          ...storage,
          async activeSessionVersion(id) {
            const value = await storage.activeSessionVersion(id);
            entered();
            await gate;
            return value;
          },
        }),
        createId: () => 'new-turn',
        now: () => '2026-10-05T00:00:00.000Z',
      });
      const restore = jest.fn(async () => []);
      const store = createConversationSessions({
        retention,
        restoreSession: restore,
      });
      const pending = store.attachExisting(
        'saved',
        0,
        '2026-10-05T00:00:00.000Z',
      );
      await reading;
      if (action === 'clear') store.invalidateAll();
      else store.dispose();
      release();
      await expect(pending).rejects.toThrow();
      expect(restore).not.toHaveBeenCalled();
      expect(store.getSnapshot().sessions).toHaveLength(1);
      if (action === 'clear') store.dispose();
    } finally {
      f.close();
    }
  },
);

test.each(['clear', 'dispose', 'remove'] as const)(
  '%s while the transcript is loading does not report a successful attachment',
  async action => {
    const f = await healthContextFixture();
    try {
      const storage = createConversationArtifactStorage(f.database);
      await storage.createSession('saved', await storage.currentGeneration());
      let entered!: () => void;
      let release!: () => void;
      const reading = new Promise<void>(resolve => {
        entered = resolve;
      });
      const gate = new Promise<void>(resolve => {
        release = resolve;
      });
      const retention = createConversationSessionRetention({
        openStorage: async () => storage,
        createId: () => 'new-turn',
        now: () => '2026-10-05T00:00:00.000Z',
      });
      const store = createConversationSessions({
        retention,
        restoreSession: async () => {
          entered();
          await gate;
          return [
            { question: 'old question', answer: 'old answer', citations: [] },
          ];
        },
      });
      const pending = store.attachExisting(
        'saved',
        0,
        '2026-10-05T00:00:00.000Z',
      );
      await reading;
      if (action === 'clear') store.invalidateAll();
      else if (action === 'dispose') store.dispose();
      else await store.remove(store.getSnapshot().activeId);
      release();
      await expect(pending).rejects.toThrow();
      expect(
        store.getSnapshot().sessions.flatMap(item => item.messages),
      ).toEqual([]);
      if (action !== 'dispose') store.dispose();
    } finally {
      f.close();
    }
  },
);

test('a synchronous clear on publication does not start an orphaned restoration', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    await storage.createSession('saved', await storage.currentGeneration());
    const retention = createConversationSessionRetention({
      openStorage: async () => storage,
      createId: () => 'new-turn',
      now: () => '2026-10-05T00:00:00.000Z',
    });
    const restore = jest.fn(async () => []);
    const store = createConversationSessions({
      retention,
      restoreSession: restore,
    });
    const unsubscribe = store.subscribe(() => {
      if (store.getSnapshot().sessions.length > 1) store.invalidateAll();
    });
    await expect(
      store.attachExisting('saved', 0, '2026-10-05T00:00:00.000Z'),
    ).rejects.toThrow();
    expect(restore).not.toHaveBeenCalled();
    unsubscribe();
    store.dispose();
  } finally {
    f.close();
  }
});

test('a failed restoration leaves the attached session available for retry', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    await storage.createSession('saved', await storage.currentGeneration());
    const retention = createConversationSessionRetention({
      openStorage: async () => storage,
      createId: () => 'new-turn',
      now: () => '2026-10-05T00:00:00.000Z',
    });
    const restore = jest
      .fn()
      .mockRejectedValueOnce(new Error('temporarily unavailable'))
      .mockResolvedValueOnce([
        { question: 'question', answer: 'answer', citations: [] },
      ]);
    const store = createConversationSessions({
      retention,
      restoreSession: restore,
    });
    const id = await store.attachExisting(
      'saved',
      0,
      '2026-10-05T00:00:00.000Z',
    );
    expect(
      store.getSnapshot().sessions.find(item => item.id === id)?.restoreFailed,
    ).toBe(true);
    await store.retryRestore(id);
    expect(
      store
        .getSnapshot()
        .sessions.find(item => item.id === id)
        ?.messages.map(item => item.content),
    ).toEqual(['question', 'answer']);
    store.dispose();
  } finally {
    f.close();
  }
});
