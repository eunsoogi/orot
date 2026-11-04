import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';

test('an unrelated deletion does not invalidate a retained parent period', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    const generation = await storage.currentGeneration();
    await storage.createSession('old', generation);
    await storage.createSession('new', generation);
    const parent = {
      id: 'parent',
      sessionId: 'old',
      createdAt: '2026-10-05T00:00:00.000Z',
      providerId: 'provider',
      modelId: 'model',
      status: 'complete' as const,
      question: 'question',
      answer: 'answer',
      sources: f.saved.sources,
      citations: [f.saved.sources[0]!.reference],
    };
    await storage.append(parent);
    await f.repository.put('health_observation', {
      ...f.inside,
      id: 'outside',
      effectiveAt: '2026-11-01T01:00:00Z',
    });
    await f.repository.delete('health_observation', 'outside');
    const revision = fingerprint(parent);
    const ref = {
      sourceKind: 'generated_artifact' as const,
      sourceId: parent.id,
      sourceRevision: revision,
      evidenceId: parent.id,
      evidenceRevision: revision,
      locator: { kind: 'generated_artifact', type: 'conversation_turn' },
      effectiveTime: null,
      reviewState: 'unreviewed' as const,
    };
    await storage.append({
      id: 'child',
      sessionId: 'new',
      createdAt: parent.createdAt,
      providerId: 'provider',
      modelId: 'model',
      status: 'complete',
      question: 'question',
      answer: 'answer',
      sources: [
        {
          kind: 'generated_conversation',
          reference: ref,
          id: parent.id,
          revision,
        },
      ],
      citations: [ref],
    });
    expect(await storage.read('child')).not.toBeNull();
  } finally {
    f.close();
  }
});
