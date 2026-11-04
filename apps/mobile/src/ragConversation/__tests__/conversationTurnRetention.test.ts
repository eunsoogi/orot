import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { createConversationTurnRetention } from '../conversationTurnRetention';

test('a failed write retries the same answer without another model call or duplication', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    await storage.createSession('session', await storage.currentGeneration());
    let fail = true;
    const retention = createConversationTurnRetention({
      sessionId: 'session',
      turnId: 'turn',
      createdAt: '2026-10-05T00:00:00.000Z',
      storage: {
        append: async (...args) => {
          if (fail) {
            fail = false;
            throw new Error('write failed');
          }
          await storage.append(...args);
        },
      },
    });
    const candidate = {
      question: 'question',
      answer: 'answer',
      providerId: 'provider',
      modelId: 'model',
      sources: f.saved.sources,
      citations: [f.saved.sources[0]!.reference],
    };
    await expect(
      retention.save(candidate, new AbortController().signal),
    ).rejects.toThrow('write failed');
    (candidate as { answer: string }).answer = 'mutated after failure';
    expect(retention.canRetry()).toBe(true);
    await retention.retry();
    expect(retention.canRetry()).toBe(false);
    expect(await storage.read('turn')).toMatchObject({
      question: 'question',
      answer: 'answer',
      citations: candidate.citations,
    });
    expect((await storage.list('session')).items).toHaveLength(1);
  } finally {
    f.close();
  }
});

test.each(['source', 'session'] as const)(
  'a retry cannot restore output after its %s is deleted',
  async removed => {
    const f = await healthContextFixture();
    try {
      const storage = createConversationArtifactStorage(f.database);
      await storage.createSession('session', await storage.currentGeneration());
      let fail = true;
      const retention = createConversationTurnRetention({
        sessionId: 'session',
        turnId: 'turn',
        createdAt: '2026-10-05T00:00:00.000Z',
        storage: {
          append: async (...args) => {
            if (fail) {
              fail = false;
              throw new Error('write failed');
            }
            await storage.append(...args);
          },
        },
      });
      await expect(
        retention.save(
          {
            question: 'question',
            answer: 'answer',
            providerId: 'provider',
            modelId: 'model',
            sources: f.saved.sources,
            citations: [],
          },
          new AbortController().signal,
        ),
      ).rejects.toThrow();
      if (removed === 'session') await storage.deleteSession('session');
      else await f.repository.delete('health_observation', f.inside.id);
      await expect(retention.retry()).rejects.toThrow();
      expect(await storage.read('turn')).toBeNull();
    } finally {
      f.close();
    }
  },
);

test('cancellation before commit clears the retry candidate', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    await storage.createSession('session', await storage.currentGeneration());
    const retention = createConversationTurnRetention({
      sessionId: 'session',
      turnId: 'turn',
      createdAt: '2026-10-05T00:00:00.000Z',
      storage: {
        append: async (_value, signal) =>
          new Promise<void>((_resolve, reject) => {
            signal!.addEventListener(
              'abort',
              () => reject(new Error('cancelled')),
              { once: true },
            );
          }),
      },
    });
    const controller = new AbortController();
    const pending = retention.save(
      {
        question: 'question',
        answer: 'answer',
        providerId: 'provider',
        modelId: 'model',
        sources: f.saved.sources,
        citations: [],
      },
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(retention.canRetry()).toBe(false);
    expect(await storage.read('turn')).toBeNull();
  } finally {
    f.close();
  }
});
