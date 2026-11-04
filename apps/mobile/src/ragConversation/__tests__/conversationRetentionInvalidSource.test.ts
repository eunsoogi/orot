import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationSessions } from '../conversationSessions';

test('source deletion after a temporary write failure removes the now-invalid pending answer', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    let sequence = 0;
    let first = true;
    const retention = createConversationSessionRetention({
      openStorage: async () => ({
        ...storage,
        async append(...args) {
          if (first) {
            first = false;
            throw new Error('temporary storage error');
          }
          return storage.append(...args);
        },
      }),
      createId: () => `id-${++sequence}`,
      now: () => '2026-10-05T00:00:00.000Z',
    });
    const store = createConversationSessions({ retention });
    store.setDraft(1, 'question');
    await store.send(1, async (_q, _history, signal, observer) => {
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
    expect(store.getSnapshot().sessions[0]?.unsavedCount).toBe(1);
    await f.repository.delete('health_observation', 'inside');
    await store.retrySave(1);
    expect(store.getSnapshot().sessions[0]?.unsavedCount).toBe(0);
    expect(store.getSnapshot().sessions[0]?.error).toContain('원본이 변경');
    expect(await storage.read('id-2')).toBeNull();
    store.dispose();
  } finally {
    f.close();
  }
});

test('removing a conversation during preparation cannot save its delayed result', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    let sequence = 0;
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>(resolve => {
      entered = resolve;
    });
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const retention = createConversationSessionRetention({
      openStorage: async () => storage,
      createId: () => `id-${++sequence}`,
      now: () => '2026-10-05T00:00:00.000Z',
    });
    const store = createConversationSessions({
      retention,
      restoreSession: async () => [],
    });
    store.setDraft(1, 'question');
    await store.send(1, async (_q, _history, _signal, observer) => {
      observer!.onRetentionFailure!(async () => {
        entered();
        await gate;
        return {
          question: 'question',
          answer: 'answer',
          providerId: 'provider',
          modelId: 'model',
          sources: f.saved.sources,
          citations: [f.saved.sources[0]!.reference],
        };
      });
      return { status: 'answer', answer: 'answer', citations: [] };
    });
    const retry = store.retrySave(1);
    await started;
    await store.remove(1);
    release();
    await retry;
    expect(await storage.read('id-2')).toBeNull();
    store.dispose();
  } finally {
    f.close();
  }
});
