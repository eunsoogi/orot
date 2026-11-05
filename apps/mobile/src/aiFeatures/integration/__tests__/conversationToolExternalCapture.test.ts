import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createResearchArtifactStorage } from '../../../storage/researchArtifactStorage';
import { createResearchArtifactDiscovery } from '../researchArtifactDiscovery';
import { createSelectedExternalEvidence } from '../selectedExternalEvidence';
import { retainLiteratureResults } from '../researchRetention';
import { createResearchInputTracker } from '../researchInputTracker';
import { captureConversationToolSources } from '../captureConversationToolSources';
import { bindLiveConversationToolSources } from '../bindLiveConversationToolSources';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';

test('actual public search adapters bind their returned identities to exact retained research rows', async () => {
  const db = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(db.database);
    const conversations = createConversationArtifactStorage(db.database);
    const research = createResearchArtifactStorage(db.database);
    await conversations.createSession(
      'session',
      await conversations.currentGeneration(),
    );
    const data = {
      ...localData([]).data,
      openResearchArtifactStorage: async () => research,
      researchArtifactDiscovery: async () =>
        createResearchArtifactDiscovery(research),
    };
    const registry = new LocalEvidenceReferenceRegistry();
    const tracker = createResearchInputTracker(registry, data, 'session');
    const run = publicEvidenceFixture();
    const publication = {
      provider: 'Europe PMC' as const,
      source: 'MED',
      recordId: '123',
      title: 'Study',
      authors: null,
      journal: null,
      publicationDate: null,
      updatedDate: '2025-01-01',
      originalUrl: 'https://europepmc.org/article/MED/123',
      retrievedAt: '2026-10-05T00:00:00.000Z',
      abstract: 'Public abstract',
    };
    const selected = createSelectedExternalEvidence({
      ...run,
      loadData: async () => data,
      originFeature: 'record_conversation',
      retentionSession: { id: 'session', version: 0 },
      captureResearchInputs: async () => [],
      onResearchRetained: tracker.recordResearch,
      literature: retainLiteratureResults(
        {
          search: async () => ({
            status: 'available',
            publications: [publication],
          }),
        },
        async () => data,
        'record_conversation',
        { id: 'session', version: 0 },
        tracker.recordResearch,
      ),
      literatureConsent: { authorize: async () => 'authorized' },
    });
    const web = selected.tools.find(item => item.id === 'public-web-search')!;
    const literature = selected.tools.find(
      item => item.id !== 'public-web-search',
    )!;
    const [webResult, paperResult] = await Promise.all([
      web.search(run.request),
      literature.search({
        ...run.request,
        operationKey: 'paper',
        allowedScope: { sourceKinds: ['external_medical'] },
      }),
    ]);
    if ('status' in webResult || 'status' in paperResult)
      throw new Error('Search failed');
    for (const [index, result] of [webResult, paperResult].entries()) {
      const event = {
        version: 1 as const,
        operationRunId: run.request.operationRunId,
        callId: index === 0 ? run.request.operationKey : 'paper',
        toolName: 'search',
        order: index,
        status: 'completed' as const,
        inputSummary: { sourceKind: 'external_medical' as const },
        sources: result.items,
      };
      const captured = await captureConversationToolSources(
        event,
        registry,
        conversations,
        'session',
      );
      expect(captured.dependencies).toHaveLength(1);
      await conversations.appendToolEvent({
        sessionId: 'session',
        messageId: `message-${index}`,
        createdAt: '2026-11-06T00:00:00.000Z',
        sessionVersion: 0,
        ...captured,
      });
      await bindLiveConversationToolSources(
        captured.event,
        'session',
        conversations,
        data,
        registry,
      );
      expect(
        await registry.resolveToolSource(
          result.items[0]!,
          run.controller.signal,
          { ...event, sessionId: 'session' },
        ),
      ).toMatchObject({
        sourceKind: 'external_medical',
        sourceId: index === 0 ? 'public-web' : 'europe-pmc',
      });
      await conversations.discardToolEvent({
        sessionId: 'session',
        messageId: `message-${index}`,
        sessionVersion: 0,
        operationRunId: event.operationRunId,
        callId: event.callId,
      });
      expect(
        await registry.resolveToolSource(
          result.items[0]!,
          run.controller.signal,
          { ...event, sessionId: 'session' },
        ),
      ).toBeUndefined();
    }
  } finally {
    db.close();
  }
});
