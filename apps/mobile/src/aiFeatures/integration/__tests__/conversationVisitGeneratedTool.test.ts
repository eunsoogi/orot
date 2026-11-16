import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createConversationArtifactDiscovery } from '../conversationArtifactDiscovery';
import { createVisitQuestionSourceService } from '../visitQuestionSourceRegistration';
import { createConversationVisitToolSource } from '../conversationVisitToolSource';
import { captureConversationToolSources } from '../captureConversationToolSources';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { fingerprint } from '../evidenceUtils';
import { localData } from '../featureServiceFixtures';

// Synthetic generated parent, real registration/capture and SQLite retention contracts.
test('an unregistered generated visit source keeps its durable parent identity behind opaque aliases', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const storage = createConversationArtifactStorage(connection.database);
    const generation = await storage.currentGeneration();
    await storage.createSession('parent', generation);
    await storage.createSession('child', generation);
    const parent = {
      id: 'synthetic-parent',
      sessionId: 'parent',
      createdAt: '2026-11-16T00:00:00.000Z',
      providerId: 'provider',
      modelId: 'model',
      status: 'complete' as const,
      question: 'Synthetic question',
      answer: 'Synthetic answer',
      sources: [],
      citations: [],
    };
    await storage.append(parent);
    const revision = fingerprint(parent);
    const registry = new LocalEvidenceReferenceRegistry();
    const data = localData([]).data;
    const service = createVisitQuestionSourceService(registry, async () => ({
      ...data,
      conversationArtifactDiscovery: async (
        r: LocalEvidenceReferenceRegistry,
      ) =>
        createConversationArtifactDiscovery({
          database: connection.database,
          storage,
          registry: r,
          data,
        }),
    }));
    const source = createConversationVisitToolSource(
      registry,
      service.registerVisitQuestionSource,
    )(
      {
        sourceKind: 'generated_artifact',
        sourceId: parent.id,
        evidenceId: parent.id,
        sourceRevision: revision,
        evidenceRevision: revision,
        locator: { kind: 'generated_artifact', type: 'conversation_turn' },
        effectiveTime: null,
        reviewState: 'unknown',
        content: 'Synthetic generated parent',
      },
      async () => true,
    );
    expect(source.sourceId).not.toBe(parent.id);
    const captured = await captureConversationToolSources(
      {
        version: 1,
        operationRunId: 'run',
        callId: 'call',
        toolName: 'search',
        order: 1,
        status: 'completed',
        inputSummary: { sourceKind: 'generated_artifact' },
        resultSummary: { referenceCount: 1 },
        sources: [source],
      },
      registry,
      storage,
      'child',
    );
    await storage.appendToolEvent({
      sessionId: 'child',
      messageId: 'turn',
      sessionVersion: 0,
      createdAt: parent.createdAt,
      ...captured,
    });
    const turns = await storage.readToolTurns('child', 0);
    expect(turns[0]?.toolEvents[0]?.status).toBe('completed');
    expect(turns[0]?.lineages[0]?.sources[0]).toMatchObject({
      kind: 'generated_conversation',
      id: parent.id,
      revision,
    });
    await storage.deleteSession('parent');
    expect(await storage.readToolTurns('child', 0)).toEqual([]);
    await expect(
      captureConversationToolSources(
        { ...captured.event, sources: [source] },
        registry,
        storage,
        'child',
      ),
    ).rejects.toThrow();
  } finally {
    connection.close();
  }
});
