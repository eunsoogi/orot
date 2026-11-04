import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { createConversationSessionRetention } from '../conversationSessionRetention';

test('session undo issues a new write lease and never permits a previous turn to resume', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    let sequence = 0;
    const sessions = createConversationSessionRetention({
      openStorage: async () => storage,
      createId: () => `id-${++sequence}`,
      now: () => '2026-10-05T00:00:00.000Z',
    });
    const old = await sessions.beginTurn(1, new AbortController().signal);
    const candidate = {
      question: 'question',
      answer: 'answer',
      providerId: 'provider',
      modelId: 'model',
      sources: f.saved.sources,
      citations: [f.saved.sources[0]!.reference],
    };
    await old.save(candidate, new AbortController().signal);
    const undo = await sessions.hide(1);
    expect(await storage.read('id-2')).toBeNull();
    await sessions.undo(1, undo);
    expect(await storage.read('id-2')).not.toBeNull();
    await expect(
      old.save(candidate, new AbortController().signal),
    ).rejects.toThrow();
    const fresh = await sessions.beginTurn(1, new AbortController().signal);
    await fresh.save(candidate, new AbortController().signal);
    expect(await storage.read('id-3')).not.toBeNull();
  } finally {
    f.close();
  }
});

test('removal fences a session whose storage setup has not finished', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    let opens = 0;
    const sessions = createConversationSessionRetention({
      openStorage: async () => {
        if (++opens === 1) await gate;
        return storage;
      },
      createId: () => 'pending-session',
      now: () => '2026-10-05T00:00:00.000Z',
    });
    const pending = sessions.beginTurn(1, new AbortController().signal);
    const handle = await sessions.hide(1);
    release();
    await expect(pending).rejects.toThrow();
    await sessions.undo(1, handle);
    expect(await storage.read('pending-session')).toBeNull();
  } finally {
    f.close();
  }
});

test('an uncertain session creation can retry without duplicating the session', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    let first = true;
    const sessions = createConversationSessionRetention({
      openStorage: async () => ({
        ...storage,
        async createSession(id, generation) {
          const result = await storage.createSession(id, generation);
          if (first) {
            first = false;
            throw new Error('connection lost');
          }
          return result;
        },
      }),
      createId: () => 'stable-session',
      now: () => '2026-10-05T00:00:00.000Z',
    });
    await expect(
      sessions.beginTurn(1, new AbortController().signal),
    ).rejects.toThrow('connection lost');
    await expect(
      sessions.beginTurn(1, new AbortController().signal),
    ).resolves.toBeDefined();
  } finally {
    f.close();
  }
});

test('a turn waiting for storage cannot acquire a lease issued after undo', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    let block = false;
    let sequence = 0;
    const sessions = createConversationSessionRetention({
      openStorage: async () => {
        if (block) {
          block = false;
          await gate;
        }
        return storage;
      },
      createId: () => `id-${++sequence}`,
      now: () => '2026-10-05T00:00:00.000Z',
    });
    await sessions.beginTurn(1, new AbortController().signal);
    block = true;
    const stale = sessions.beginTurn(1, new AbortController().signal);
    const handle = await sessions.hide(1);
    await sessions.undo(1, handle);
    release();
    await expect(stale).rejects.toThrow();
  } finally {
    f.close();
  }
});
