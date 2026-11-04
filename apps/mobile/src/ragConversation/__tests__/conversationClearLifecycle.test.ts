import { createConversationSessions } from '../conversationSessions';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';

test('clearing local data invalidates cached text and prevents late committed answers returning to the screen', async () => {
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
    await f.repository.deleteAllLocalData();
    store.invalidateAll();
    release();
    await running;
    expect(JSON.stringify(store.getSnapshot())).not.toContain('question');
    expect(JSON.stringify(store.getSnapshot())).not.toContain('answer');
    expect(await storage.read('id-2')).toBeNull();
  } finally {
    f.close();
  }
});

test('disposing while a committed hide awaits acknowledgement finalizes its hidden data', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    let release!: () => void;
    let hidden!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const committed = new Promise<void>(resolve => {
      hidden = resolve;
    });
    let sequence = 0;
    const retention = createConversationSessionRetention({
      openStorage: async () => ({
        ...storage,
        async hideSession(...args) {
          const version = await storage.hideSession(...args);
          hidden();
          await gate;
          return version;
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
    const removing = store.remove(1);
    await committed;
    store.dispose();
    release();
    await removing;
    expect(
      (
        await f.database.execute(
          'SELECT id FROM conversation_artifact_sessions WHERE id = ?',
          ['id-1'],
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await f.database.execute(
          'SELECT id FROM conversation_artifacts WHERE id = ?',
          ['id-2'],
        )
      ).rows,
    ).toEqual([]);
  } finally {
    f.close();
  }
});
