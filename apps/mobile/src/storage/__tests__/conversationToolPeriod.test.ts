import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { captureConversationToolSources } from '../../aiFeatures/integration/captureConversationToolSources';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import { createConversationArtifactDiscovery } from '../../aiFeatures/integration/conversationArtifactDiscovery';
import { createConversationSessionOptions } from '../../aiFeatures/integration/conversationSessionOptions';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { localData } from '../../aiFeatures/integration/featureServiceFixtures';

test('a tool-only period survives unrelated deletion and is removed with a contributor', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    await storage.createSession('session', await storage.currentGeneration());
    const {
      sourceKind,
      sourceId,
      sourceRevision,
      evidenceId,
      evidenceRevision,
    } = f.item;
    const captured = await captureConversationToolSources(
      {
        version: 1,
        operationRunId: 'run',
        callId: 'call',
        toolName: 'health',
        order: 1,
        status: 'completed',
        inputSummary: { sourceKind },
        resultSummary: { referenceCount: 1 },
        sources: [
          {
            sourceKind,
            sourceId,
            sourceRevision,
            evidenceId,
            evidenceRevision,
          },
        ],
      },
      f.registry,
    );
    const input = {
      sessionId: 'session',
      messageId: 'turn',
      createdAt: '2026-11-06T00:00:00.000Z',
      sessionVersion: 0,
      ...captured,
    };
    await storage.appendToolEvent(input);
    const registry = new LocalEvidenceReferenceRegistry();
    const data = { ...localData([]).data, readHealthContext: f.read };
    const options = createConversationSessionOptions({
      registry,
      loadLocalData: async () => ({
        ...data,
        openConversationArtifactStorage: async () => storage,
        conversationArtifactDiscovery: async () =>
          createConversationArtifactDiscovery({
            database: f.database,
            storage,
            data,
            registry,
          }),
      }),
    });
    const [restored] = await options.restoreSession!(
      'session',
      new AbortController().signal,
    );
    const alias = registry.resolveToolReference(
      restored!.toolEvents![0]!.sources[0]!,
    )!;
    expect(
      (await registry.readSource(alias, new AbortController().signal)).status,
    ).toBe('available');
    await f.database.execute(
      'INSERT INTO source_deletion_tombstones (source_id) VALUES (?)',
      ['unrelated'],
    );
    expect(await storage.readToolTurns('session')).toHaveLength(1);
    await f.database.execute(
      'INSERT INTO source_deletion_tombstones (source_id) VALUES (?)',
      [f.inside.id],
    );
    expect(await storage.readToolTurns('session')).toEqual([]);
    expect(
      (await registry.readSource(alias, new AbortController().signal)).status,
    ).toBe('unavailable');
    await expect(storage.appendToolEvent(input)).rejects.toThrow();
  } finally {
    f.close();
  }
});
