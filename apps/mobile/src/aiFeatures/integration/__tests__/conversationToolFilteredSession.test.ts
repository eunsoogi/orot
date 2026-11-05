import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createConversationSessions } from '../../../ragConversation/conversationSessions';
import { healthContextFixture } from '../testSupport/healthContextPersistenceFixture';
import { registerHealthContextEvidence } from '../healthContextEvidence';
import { createConversationSessionOptions } from '../conversationSessionOptions';
import { createConversationArtifactDiscovery } from '../conversationArtifactDiscovery';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';

test('the app session retains a real filtered tool call without retaining its input', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    const window = {
      fromInclusive: '2026-10-01T00:00:00Z',
      toExclusive: '2026-10-03T00:00:00Z',
      timeZone: 'UTC',
      doseHistory: { medicationName: 'PRIVATE_QUERY', page: 0, pageSize: 1 },
    };
    const scope = {
      kind: 'health_context_period' as const,
      version: 1 as const,
      topic: 'medications' as const,
      window,
    };
    const report = await f.read(window, ['medications']);
    const item = registerHealthContextEvidence({
      registry: f.registry,
      read: f.read,
      scope,
      report,
    });
    const data = { ...localData([]).data, readHealthContext: f.read };
    const loadLocalData = async () => ({
      ...data,
      openConversationArtifactStorage: async () => storage,
      conversationArtifactDiscovery: async (
        registry: LocalEvidenceReferenceRegistry,
      ) =>
        createConversationArtifactDiscovery({
          database: f.database,
          storage,
          data,
          registry,
        }),
    });
    const options = createConversationSessionOptions({
      registry: f.registry,
      loadLocalData,
    });
    const sessions = createConversationSessions(options);
    sessions.setDraft(1, 'question');
    const {
      sourceKind,
      sourceId,
      sourceRevision,
      evidenceId,
      evidenceRevision,
    } = item;
    await sessions.send(1, async (_question, _history, _signal, observer) => {
      observer!.onToolEvent!({
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
      });
      return { status: 'failure', kind: 'unavailable' };
    });
    const sessionId = options.retention!.activeIdentity(1)!;
    expect(await storage.readToolTurns(sessionId)).toHaveLength(1);
    expect(
      JSON.stringify(
        (
          await f.database.execute(
            'SELECT sources_json FROM conversation_tool_lineage',
          )
        ).rows,
      ),
    ).not.toContain('PRIVATE_QUERY');
    const fresh = new LocalEvidenceReferenceRegistry();
    const restored = await createConversationSessionOptions({
      registry: fresh,
      loadLocalData,
    }).restoreSession!(sessionId, new AbortController().signal);
    const alias = fresh.resolveToolReference(
      restored[0]!.toolEvents![0]!.sources[0]!,
    )!;
    expect(
      (await fresh.readSource(alias, new AbortController().signal)).status,
    ).toBe('available');
    sessions.dispose();
  } finally {
    f.close();
  }
});
