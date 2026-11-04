import { createConversationSessions } from '../conversationSessions';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';

test('an uncertain deletion stays visible as failed and can retry without reviving the session', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    let first = true;
    let sequence = 0;
    const retention = createConversationSessionRetention({
      openStorage: async () => ({
        ...storage,
        async hideSession(...args) {
          const result = await storage.hideSession(...args);
          if (first) {
            first = false;
            throw new Error('connection lost after commit');
          }
          return result;
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
    await store.remove(1);
    expect(
      store.getSnapshot().sessions.find(item => item.id === 1)?.error,
    ).toContain('삭제하지 못했어요');
    const visible = store.getSnapshot().sessions.find(item => item.id === 1)!;
    expect(visible.messages).toEqual([]);
    expect(visible.draft).toBe('');
    expect(visible.title).not.toBe('question');
    expect(
      store.getSnapshot().sessions.find(item => item.id === 1)?.deletionError,
    ).toContain('삭제하지 못했어요');
    expect(await storage.read('id-2')).toBeNull();
    await store.remove(1);
    expect(store.getSnapshot().sessions.some(item => item.id === 1)).toBe(
      false,
    );
    expect(await storage.read('id-2')).toBeNull();
  } finally {
    f.close();
  }
});
