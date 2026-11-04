import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { reference } from '../../diseaseHypotheses/taskTestSupport';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';

test('a symptom tombstone does not hide a conversation sourced from a different kind with the same ID', async () => {
  const f = await healthContextFixture();
  try {
    const symptom = {
      id: f.inside.id,
      description: 'Synthetic symptom',
      status: 'active' as const,
      effectiveAt: '2026-10-01T01:00:00Z',
      recordedAt: '2026-10-01T01:00:00Z',
      ingestedAt: '2026-10-01T01:00:00Z',
      provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' as const },
    };
    await f.repository.put('symptom_entry', symptom);
    const storage = createConversationArtifactStorage(f.database);
    await storage.createSession('session', await storage.currentGeneration());
    const output = {
      id: 'turn',
      sessionId: 'session',
      createdAt: '2026-10-05T00:00:00.000Z',
      providerId: 'provider',
      modelId: 'model',
      status: 'complete' as const,
      question: 'question',
      answer: 'answer',
      sources: [
        {
          reference,
          records: [
            {
              kind: 'health_observation' as const,
              id: f.inside.id,
              revision: fingerprint(f.inside),
            },
          ],
        },
      ],
    };
    await storage.append(output);
    await f.database.execute(
      'INSERT INTO legacy_symptom_deleted (id) VALUES (?)',
      [symptom.id],
    );
    expect(await storage.read('turn')).not.toBeNull();
    await storage.append({ ...output, id: 'later' });
    expect(await storage.read('later')).not.toBeNull();
  } finally {
    f.close();
  }
});
