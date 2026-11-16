import { healthContextFixture } from '../testSupport/healthContextPersistenceFixture';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';
import { createConversationArtifactDiscovery } from '../conversationArtifactDiscovery';
import { createConversationSessionOptions } from '../conversationSessionOptions';
import { createConversationSessions } from '../../../ragConversation/conversationSessions';

/** Exercise the real adapter chain, not only a hand-written restoreSession callback. */
test('protected artifact receipts reach the restored user message without backfilling legacy rows', async () => {
  const f = await healthContextFixture();
  const delivery = {
    submittedAt: '2026-10-05T00:00:00.000Z',
    acceptedAt: '2026-10-05T00:00:01.000Z',
    readAt: '2026-10-05T00:00:02.000Z',
  };
  try {
    const storage = createConversationArtifactStorage(f.database);
    await storage.createSession('session', await storage.currentGeneration());
    for (const id of ['old', 'new'])
      await storage.append({
        id,
        sessionId: 'session',
        createdAt:
          id === 'old' ? '2026-10-04T00:00:00.000Z' : delivery.submittedAt,
        providerId: 'synthetic',
        modelId: 'synthetic',
        status: 'complete',
        question: id,
        answer: 'Synthetic answer',
        sources: [],
        citations: [],
        ...(id === 'new'
          ? {
              delivery,
              initialResponse: {
                callId: 'synthetic',
                text: 'Synthetic opening',
              },
            }
          : {}),
      });
    const registry = new LocalEvidenceReferenceRegistry();
    const data = { ...localData([]).data, readHealthContext: f.read };
    const options = createConversationSessionOptions({
      registry,
      loadLocalData: async () => ({
        ...data,
        openConversationArtifactStorage: async () => storage,
        conversationArtifactDiscovery: async fresh =>
          createConversationArtifactDiscovery({
            database: f.database,
            storage,
            registry: fresh,
            data,
          }),
      }),
    });
    const restored = await options.restoreSession!(
      'session',
      new AbortController().signal,
    );
    expect(restored.find(t => t.question === 'new')?.delivery).toEqual(
      delivery,
    );
    // This fixture has no task/steering records; those readers are covered separately.
    const sessions = createConversationSessions({
      ...options,
      restoreTasks: undefined,
      restoreSteering: undefined,
    });
    const id = await sessions.attachExisting(
      'session',
      0,
      delivery.submittedAt,
    );
    expect(
      sessions.getSnapshot().sessions.find(s => s.id === id)?.restoreFailed,
    ).not.toBe(true);
    const messages = sessions
      .getSnapshot()
      .sessions.find(s => s.id === id)!.messages;
    expect(
      messages.find(m => m.role === 'user' && m.content === 'new')?.delivery,
    ).toEqual(delivery);
    expect(
      messages.find(m => m.role === 'user' && m.content === 'old')?.delivery,
    ).toBeUndefined();
    expect(messages.find(m => m.initialResponse)?.initialResponse?.text).toBe(
      'Synthetic opening',
    );
    sessions.dispose();
    await storage.deleteSession('session');
    await expect(
      options.restoreSession!('session', new AbortController().signal),
    ).rejects.toThrow();
  } finally {
    f.close();
  }
});
