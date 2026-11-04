import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { createSummaryArtifactDiscovery } from '../../aiFeatures/integration/summaryArtifactDiscovery';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { localData } from '../../aiFeatures/integration/featureServiceFixtures';

test.each(['before', 'after'] as const)(
  'a summary source changed and restored %s conversation save cannot resurrect the result',
  async timing => {
    const f = await healthContextFixture();
    try {
      const summary = { ...f.saved, inputLineage: 'complete' as const };
      await f.storage.append(summary);
      const revision = fingerprint(summary);
      const generated = {
        sourceKind: 'generated_artifact' as const,
        sourceId: summary.id,
        sourceRevision: revision,
        evidenceId: summary.id,
        evidenceRevision: revision,
        locator: { kind: 'generated_artifact', type: 'symptom_summary' },
        effectiveTime: null,
        reviewState: 'unreviewed' as const,
      };
      const turn = {
        id: 'answer',
        sessionId: 'session',
        createdAt: '2026-10-05T00:00:00.000Z',
        providerId: 'provider',
        modelId: 'model',
        status: 'complete' as const,
        question: 'question',
        answer: 'answer',
        sources: [
          {
            kind: 'generated_summary' as const,
            reference: generated,
            id: summary.id,
            revision,
          },
        ],
        citations: [generated],
      };
      const storage = createConversationArtifactStorage(f.database);
      if (timing === 'after') {
        await storage.createSession(
          'session',
          await storage.currentGeneration(),
        );
        await storage.append(turn);
      }
      await f.repository.put('health_observation', {
        ...f.inside,
        value: { kind: 'quantity', amount: 99, unit: 'count/min' },
      });
      await f.repository.put('health_observation', f.inside);
      const registry = new LocalEvidenceReferenceRegistry();
      const data = { ...localData([]).data, readHealthContext: f.read };
      const discovery = createSummaryArtifactDiscovery({
        database: f.database,
        storage: f.storage,
        data,
        registry,
      });
      expect((await discovery.read(summary.id))?.sourceStatus).toBe('changed');
      expect(
        await discovery.revalidatePage(
          [{ id: summary.id, revision }],
          new AbortController().signal,
        ),
      ).toBe(false);
      if (timing === 'before')
        await storage.createSession(
          'session',
          await storage.currentGeneration(),
        );
      else {
        expect(await storage.read('answer')).toBeNull();
        expect(
          (
            await f.database.execute(
              'SELECT id FROM conversation_artifacts WHERE id = ?',
              ['answer'],
            )
          ).rows,
        ).toEqual([]);
      }
      await expect(storage.append(turn)).rejects.toThrow();
    } finally {
      f.close();
    }
  },
);

test('an unrelated observation outside the saved period does not invalidate its summary parent', async () => {
  const f = await healthContextFixture();
  try {
    const summary = { ...f.saved, inputLineage: 'complete' as const };
    await f.storage.append(summary);
    await f.repository.put('health_observation', {
      ...f.inside,
      id: 'outside',
      effectiveAt: '2026-11-01T01:00:00Z',
    });
    const revision = fingerprint(summary);
    const generated = {
      sourceKind: 'generated_artifact' as const,
      sourceId: summary.id,
      sourceRevision: revision,
      evidenceId: summary.id,
      evidenceRevision: revision,
      locator: { kind: 'generated_artifact', type: 'symptom_summary' },
      effectiveTime: null,
      reviewState: 'unreviewed' as const,
    };
    const storage = createConversationArtifactStorage(f.database);
    await storage.createSession('session', await storage.currentGeneration());
    await storage.append({
      id: 'answer',
      sessionId: 'session',
      createdAt: '2026-10-05T00:00:00.000Z',
      providerId: 'provider',
      modelId: 'model',
      status: 'complete',
      question: 'question',
      answer: 'answer',
      sources: [
        {
          kind: 'generated_summary',
          reference: generated,
          id: summary.id,
          revision,
        },
      ],
      citations: [generated],
    });
    expect(await storage.read('answer')).not.toBeNull();
  } finally {
    f.close();
  }
});
