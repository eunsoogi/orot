import { healthContextFixture } from '../testSupport/healthContextPersistenceFixture';
import { captureConversationToolSources } from '../captureConversationToolSources';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { bindLiveConversationToolSources } from '../bindLiveConversationToolSources';
import { localData } from '../featureServiceFixtures';

// Real SQLite: unrelated historical health changes must not invalidate a newly saved public call.
test('source-change invalidation removes historical periods before binding a new public call', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    await storage.createSession('session', await storage.currentGeneration());
    const event = {
      version: 1 as const,
      operationRunId: 'old-run',
      callId: 'old-call',
      toolName: 'health',
      order: 1,
      status: 'completed' as const,
      inputSummary: { sourceKind: 'personal_record' as const },
      sources: [f.item],
    };
    const captured = await captureConversationToolSources(event, f.registry);
    const identity = {
      sessionId: 'session',
      messageId: 'old-turn',
      createdAt: '2026-11-06T00:00:00.000Z',
      sessionVersion: 0,
    };
    await storage.appendToolEvent({ ...identity, ...captured });
    await f.repository.put('health_observation', {
      ...f.inside,
      id: 'new-observation',
    });
    expect(await storage.readToolTurns('session')).toEqual([]);
    const current = {
      ...event,
      operationRunId: 'new-run',
      callId: 'new-call',
      inputSummary: { sourceKind: 'external_medical' as const },
      sources: [
        {
          sourceKind: 'external_medical' as const,
          sourceId: 'public-web',
          evidenceId: 'web',
          sourceRevision: 'retrieved:synthetic',
          evidenceRevision: 'snapshot:synthetic',
        },
      ],
    };
    await storage.appendToolEvent({
      ...identity,
      messageId: 'new-turn',
      event: current,
    });
    await expect(
      bindLiveConversationToolSources(
        current,
        'session',
        storage,
        { ...localData([]).data, readHealthContext: f.read },
        f.registry,
      ),
    ).resolves.toBeUndefined();
  } finally {
    f.close();
  }
});
