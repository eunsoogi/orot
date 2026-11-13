import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationSessions } from '../conversationSessions';

test('an observer stopped during protected attachment cannot publish an orphan session', async () => {
  const fixture = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(fixture.database);
    await storage.createSession('saved', await storage.currentGeneration());
    let resume = () => {};
    let entered = () => {};
    const blocked = new Promise<void>(resolve => {
      resume = resolve;
    });
    const reading = new Promise<void>(resolve => {
      entered = resolve;
    });
    const retention = createConversationSessionRetention({
      openStorage: async () => ({
        ...storage,
        async activeSessionVersion(id) {
          const version = await storage.activeSessionVersion(id);
          entered();
          await blocked;
          return version;
        },
      }),
      createId: () => 'new-turn',
      now: () => '2026-11-13T00:00:00.000Z',
    });
    const restore = jest.fn(async () => []);
    const store = createConversationSessions({
      retention,
      restoreSession: restore,
    });
    let active = true;
    const pending = store.attachExisting(
      'saved',
      0,
      '2026-11-13T00:00:00.000Z',
      false,
      () => active,
    );
    await reading;
    active = false;
    resume();
    await expect(pending).rejects.toThrow();
    expect(store.getSnapshot().sessions).toHaveLength(1);
    expect(restore).not.toHaveBeenCalled();
    const id = await store.attachExisting(
      'saved',
      0,
      '2026-11-13T00:00:00.000Z',
      false,
    );
    expect(retention.activeIdentity(id)).toBe('saved');
    store.dispose();
  } finally {
    fixture.close();
  }
});

test('cleanup aborts an in-flight restore before it can publish and permits a later retry', async () => {
  const fixture = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(fixture.database);
    await storage.createSession('saved', await storage.currentGeneration());
    let resume = () => {};
    let entered = () => {};
    const blocked = new Promise<void>(resolve => {
      resume = resolve;
    });
    const reading = new Promise<void>(resolve => {
      entered = resolve;
    });
    const retention = createConversationSessionRetention({
      openStorage: async () => storage,
      createId: () => 'new-turn',
      now: () => '2026-11-13T00:00:00.000Z',
    });
    const restore = jest
      .fn()
      .mockImplementationOnce(async () => {
        entered();
        await blocked;
        return [{ question: '질문', answer: '답변', citations: [] }];
      })
      .mockResolvedValue([{ question: '질문', answer: '답변', citations: [] }]);
    const store = createConversationSessions({
      retention,
      restoreSession: restore,
    });
    const owner = new AbortController();
    const pending = store.attachExisting(
      'saved',
      0,
      '2026-11-13T00:00:00.000Z',
      false,
      () => !owner.signal.aborted,
      owner.signal,
    );
    await reading;
    owner.abort();
    const afterCleanup = store.getSnapshot();
    resume();
    await expect(pending).rejects.toThrow();
    expect(store.getSnapshot()).toEqual(afterCleanup);
    const attached = store
      .getSnapshot()
      .sessions.find(
        session => retention.activeIdentity(session.id) === 'saved',
      );
    expect(attached?.restoreFailed).toBe(true);
    await store.retryRestore(attached!.id, new AbortController().signal);
    expect(
      store
        .getSnapshot()
        .sessions.find(session => session.id === attached!.id)
        ?.messages.map(message => message.content),
    ).toEqual(['질문', '답변']);
    store.dispose();
  } finally {
    fixture.close();
  }
});

test('synchronous cleanup during restored-message publication keeps the retry entry', async () => {
  const fixture = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(fixture.database);
    await storage.createSession('saved', await storage.currentGeneration());
    const retention = createConversationSessionRetention({
      openStorage: async () => storage,
      createId: () => 'new-turn',
      now: () => '2026-11-13T00:00:00.000Z',
    });
    const restore = jest
      .fn()
      .mockResolvedValue([{ question: '질문', answer: '답변', citations: [] }]);
    const store = createConversationSessions({
      retention,
      restoreSession: restore,
    });
    const owner = new AbortController();
    const unsubscribe = store.subscribe(() => {
      if (
        !owner.signal.aborted &&
        store.getSnapshot().sessions.some(session => session.messages.length)
      )
        owner.abort();
    });
    await expect(
      store.attachExisting(
        'saved',
        0,
        '2026-11-13T00:00:00.000Z',
        false,
        () => !owner.signal.aborted,
        owner.signal,
      ),
    ).rejects.toThrow();
    const attached = store
      .getSnapshot()
      .sessions.find(
        session => retention.activeIdentity(session.id) === 'saved',
      );
    expect(attached?.restoreFailed).toBe(true);
    await store.retryRestore(attached!.id, new AbortController().signal);
    expect(restore).toHaveBeenCalledTimes(2);
    expect(
      store.getSnapshot().sessions.find(session => session.id === attached!.id)
        ?.restoreFailed,
    ).toBe(false);
    unsubscribe();
    store.dispose();
  } finally {
    fixture.close();
  }
});
