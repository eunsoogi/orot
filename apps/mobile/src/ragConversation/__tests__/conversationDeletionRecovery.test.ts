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
      restoreSession: async () => {
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

test('an unverified failed hide keeps a draft until a later active-lease check succeeds', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    let activeReads = 0;
    let sequence = 0;
    const retention = createConversationSessionRetention({
      openStorage: async () => ({
        ...storage,
        async activeSessionVersion(id) {
          if (++activeReads === 2) throw new Error('temporarily unavailable');
          return storage.activeSessionVersion(id);
        },
        async hideSession() {
          throw new Error('hide failed before commit');
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
    await store.send(1, async () => ({ status: 'no_evidence' }));
    store.setDraft(1, 'private draft');
    await store.remove(1);
    expect(store.getSnapshot().sessions[0]?.quarantined).toBe(true);
    expect(store.getSnapshot().sessions[0]?.draft).toBe('');
    await store.remove(1);
    expect(store.getSnapshot().sessions[0]?.quarantined).toBe(false);
    expect(store.getSnapshot().sessions[0]?.draft).toBe('private draft');
  } finally {
    f.close();
  }
});

test('a confirmed precommit deletion failure preserves the failed output for the same-ID retry', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    let writeFailure = true;
    let sequence = 0;
    const retention = createConversationSessionRetention({
      openStorage: async () => ({
        ...storage,
        async append(...args) {
          if (writeFailure) {
            writeFailure = false;
            throw new Error('write failed');
          }
          return storage.append(...args);
        },
        async hideSession() {
          throw new Error('hide failed before commit');
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
    expect(store.getSnapshot().sessions[0]?.unsavedCount).toBe(1);
    store.setDraft(1, 'new draft');
    await store.remove(1);
    expect(store.getSnapshot().sessions[0]?.quarantined).toBe(false);
    expect(store.getSnapshot().sessions[0]?.unsavedCount).toBe(1);
    expect(store.getSnapshot().sessions[0]?.draft).toBe('new draft');
    await store.retrySave(1);
    expect((await storage.read('id-2'))?.answer).toBe('answer');
    expect(store.getSnapshot().sessions[0]?.unsavedCount).toBe(0);
    expect(
      store.getSnapshot().sessions[0]?.messages.map(item => item.content),
    ).toEqual(['question', 'answer']);
  } finally {
    f.close();
  }
});
