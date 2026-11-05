import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createResearchArtifactStorage } from '../../../storage/researchArtifactStorage';
import { createResearchArtifactDiscovery } from '../researchArtifactDiscovery';
import { createResearchInputTracker } from '../researchInputTracker';
import { createConversationSessionOptions } from '../conversationSessionOptions';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';

test('parallel calls with the same public identity retain their own source and deletion lease', async () => {
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
      openConversationArtifactStorage: async () => conversations,
      researchArtifactDiscovery: async () =>
        createResearchArtifactDiscovery(research),
    };
    const registry = new LocalEvidenceReferenceRegistry();
    const tracker = createResearchInputTracker(registry, data, 'session');
    const at = '2026-11-06T00:00:00.000Z';
    const source = {
      sourceKind: 'external_medical' as const,
      sourceId: 'public-web',
      sourceRevision: `retrieved:${at}`,
      evidenceId: 'web-result-1',
      evidenceRevision: `snapshot:${at}:1`,
    };
    const events = [0, 1].map(index => ({
      version: 1 as const,
      operationRunId: 'run',
      callId: `call-${index}`,
      toolName: 'public',
      order: index,
      status: 'completed' as const,
      inputSummary: { sourceKind: 'external_medical' as const },
      sources: [source],
    }));
    const ids = await research.append(
      [0, 1].map(index => ({
        createdAt: at,
        originFeature: 'record_conversation',
        originSession: 'session',
        providerId: 'provider',
        modelId: 'model',
        generatedText: 'output',
        inputSources: [],
        source: {
          kind: 'public_web_search' as const,
          status: 'historical_snapshot' as const,
          retrievedAt: at,
          sources: [{ title: 'Public', url: `https://example.org/${index}` }],
        },
      })),
      await research.currentGeneration(),
      undefined,
      { id: 'session', version: 0 },
    );
    await Promise.all(
      events.map((event, index) =>
        tracker.recordResearch(
          [ids[index]!],
          new AbortController().signal,
          [source],
          event,
        ),
      ),
    );
    const retention = createConversationSessionOptions({
      registry,
      loadLocalData: async () => data,
    }).retention!;
    await retention.attachExisting(1, 'session', 0);
    const turn = await retention.beginTurn(1, new AbortController().signal);
    for (const [index, event] of events.entries()) {
      expect(
        await registry.resolveToolSource(source, new AbortController().signal, {
          ...event,
          sessionId: 'session',
        }),
      ).toBeUndefined();
      await turn.recordToolEvent(event);
      expect(
        await registry.resolveToolSource(source, new AbortController().signal, {
          ...events[index]!,
          sessionId: 'session',
        }),
      ).toMatchObject({
        locator: { sources: [{ url: `https://example.org/${index}` }] },
      });
    }
    await conversations.discardToolEvent({
      sessionId: 'session',
      messageId: turn.toolMessageId,
      sessionVersion: 0,
      operationRunId: 'run',
      callId: 'call-0',
    });
    expect(
      await registry.resolveToolSource(source, new AbortController().signal, {
        ...events[0]!,
        sessionId: 'session',
      }),
    ).toBeUndefined();
    expect(
      await registry.resolveToolSource(source, new AbortController().signal, {
        ...events[1]!,
        sessionId: 'session',
      }),
    ).toMatchObject({
      locator: { sources: [{ url: 'https://example.org/1' }] },
    });
  } finally {
    db.close();
  }
});
