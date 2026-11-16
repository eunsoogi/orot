import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
const model = { providerId: 'synthetic-provider', modelId: 'a' };
const now = '2026-11-16T00:00:00.000Z';
const signal = () => new AbortController().signal;

test('same model survives reopening, model changes create new epochs without deleting any transcript', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    const a = await storage.continuousSession(model, 'a', now, signal());
    const reopened = createConversationArtifactStorage(f.database);
    expect(
      await reopened.continuousSession(model, 'unused', now, signal()),
    ).toEqual(a);
    const b = await reopened.continuousSession(
      { ...model, modelId: 'b' },
      'b',
      now,
      signal(),
    );
    const again = await reopened.continuousSession(
      model,
      'a-again',
      now,
      signal(),
    );
    expect([a.id, b.id, again.id]).toEqual(['a', 'b', 'a-again']);
    expect(
      (
        await f.database.execute(
          'SELECT id FROM conversation_artifact_sessions ORDER BY id',
        )
      ).rows.map(r => r.id),
    ).toEqual(['a', 'a-again', 'b']);
  } finally {
    f.close();
  }
});
test('first migration adopts the newest visible legacy session and preserves older records', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    const generation = await storage.currentGeneration();
    await storage.createSession('legacy', generation);
    await storage.append({
      id: 'old-turn',
      sessionId: 'legacy',
      createdAt: now,
      providerId: 'old-provider',
      modelId: 'old-model',
      status: 'complete',
      question: 'Synthetic question',
      answer: 'Synthetic answer',
      sources: f.saved.sources,
      citations: [f.saved.sources[0]!.reference],
    });
    expect(
      (await storage.continuousSession(model, 'unused', now, signal())).id,
    ).toBe('legacy');
    expect(
      (await f.database.execute('SELECT id FROM conversation_artifacts')).rows,
    ).toEqual([{ id: 'old-turn' }]);
  } finally {
    f.close();
  }
});
test('aborted selection and removed current lease cannot silently replace history', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    const a = await storage.continuousSession(model, 'a', now, signal());
    const abort = new AbortController();
    abort.abort();
    await expect(
      storage.continuousSession(
        { ...model, modelId: 'b' },
        'b',
        now,
        abort.signal,
      ),
    ).rejects.toThrow();
    expect(
      (await storage.continuousSession(model, 'unused', now, signal())).id,
    ).toBe('a');
    await storage.deleteSession(a.id);
    await expect(
      storage.continuousSession(model, 'replacement', now, signal()),
    ).rejects.toThrow('unavailable');
  } finally {
    f.close();
  }
});

test('explicit generation clearing removes even the private active pointer', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    await storage.continuousSession(model, 'old', now, signal());
    await f.database.execute(
      'UPDATE conversation_artifact_generation SET generation = generation + 1 WHERE singleton = 1',
    );
    expect(
      (await f.database.execute('SELECT * FROM conversation_active_model'))
        .rows,
    ).toEqual([]);
    const next = await storage.continuousSession(
      model,
      'after-clear',
      now,
      signal(),
    );
    expect(next.id).toBe('after-clear');
    expect(await storage.activeSessionVersion('old')).toBeNull();
  } finally {
    f.close();
  }
});
