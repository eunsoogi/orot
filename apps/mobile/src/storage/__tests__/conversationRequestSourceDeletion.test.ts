import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';

test('deleting a source removes its completed answer, request prompt, and completion', async () => {
  const f = await healthContextFixture();
  try {
    const store = createConversationArtifactStorage(f.database);
    await store.createSession('session', await store.currentGeneration());
    const request = {
      id: 'request',
      sessionId: 'session',
      sessionVersion: 0,
      question: 'Synthetic question',
      createdAt: '2026-11-13T00:00:00.000Z',
    };
    await store.startRequest(request);
    await store.append({
      id: request.id,
      sessionId: request.sessionId,
      question: request.question,
      createdAt: request.createdAt,
      providerId: 'provider',
      modelId: 'model',
      status: 'complete',
      answer: 'Synthetic answer',
      sources: f.saved.sources,
    });
    await f.repository.delete('health_observation', f.inside.id);
    expect(await store.read(request.id)).toBeNull();
    expect(await store.listCompletionIdentities()).toEqual([]);
    expect(
      (
        await f.database.execute(
          'SELECT id FROM conversation_requests WHERE id = ?',
          [request.id],
        )
      ).rows,
    ).toEqual([]);
  } finally {
    f.close();
  }
});
