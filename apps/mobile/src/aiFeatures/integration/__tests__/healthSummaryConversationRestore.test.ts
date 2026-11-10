import {
  healthContextFixture,
  window,
} from '../testSupport/healthContextPersistenceFixture';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { restoreConversationArtifact } from '../restoreConversationArtifact';
import { restoreHealthSummary } from '../restoreHealthSummary';
import { localData } from '../featureServiceFixtures';
import { createConversationArtifactDiscovery } from '../conversationArtifactDiscovery';
import { createConversationSessionOptions } from '../conversationSessionOptions';

test('reopens a conversation reference through the authoritative summary and never revives deleted content', async () => {
  const f = await healthContextFixture();
  try {
    await f.storage.append(f.saved);
    const storage = createConversationArtifactStorage(f.database);
    await storage.createSession('session', await storage.currentGeneration());
    const reference = { summaryId: f.saved.id, window };
    await storage.append({
      id: 'turn',
      sessionId: 'session',
      createdAt: '2026-10-05T00:00:00.000Z',
      providerId: 'provider',
      modelId: 'model',
      status: 'complete',
      question: '요약해 줘',
      answer: '건강 기록 요약',
      sources: [],
      citations: [],
      healthSummary: reference,
    });
    const registry = new LocalEvidenceReferenceRegistry();
    const data = { ...localData([]).data, readHealthContext: f.read };
    const turn = await restoreConversationArtifact({
      id: 'turn',
      storage,
      registry,
      data,
      signal: new AbortController().signal,
    });
    expect(turn?.healthSummary).toEqual(reference);
    const summary = await restoreHealthSummary({
      reference: turn!.healthSummary!,
      storage: f.storage,
      registry,
      data,
    });
    const source = summary?.analysis.hypotheses[0]?.supportingEvidence[0];
    expect(source).toBeDefined();
    expect(
      (await registry.readSource(source!, new AbortController().signal)).status,
    ).toBe('available');
    const restoredData = {
      ...data,
      openConversationArtifactStorage: async () => storage,
      conversationArtifactDiscovery: async (
        fresh: LocalEvidenceReferenceRegistry,
      ) =>
        createConversationArtifactDiscovery({
          database: f.database,
          storage,
          registry: fresh,
          data,
        }),
    };
    const options = createConversationSessionOptions({
      loadLocalData: async () => restoredData,
      registry,
      restoreHealthSummary: ref =>
        restoreHealthSummary({
          reference: ref,
          storage: f.storage,
          registry,
          data,
        }),
    });
    const turns = await options.restoreSession!(
      'session',
      new AbortController().signal,
    );
    expect(turns[0]?.healthSummary?.analysis.savedSummary).toMatchObject({
      status: 'saved',
      id: f.saved.id,
    });
    await f.repository.delete('health_observation', 'inside');
    expect(
      await restoreHealthSummary({
        reference,
        storage: f.storage,
        registry,
        data,
      }),
    ).toBeNull();
  } finally {
    f.close();
  }
});
