import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createConversationSessions } from '../../../ragConversation/conversationSessions';
import { referenceOnly } from '../../../diseaseHypotheses/resultValidation';
import { reference } from '../../../diseaseHypotheses/taskTestSupport';
import type { runRagConversationTurn } from '../../../ragConversation/service';
import { createConversationArtifactDiscovery } from '../conversationArtifactDiscovery';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { createAiFeatureServices } from '../featureServices';
import {
  apple,
  consent,
  localData,
  selectionStore,
} from '../featureServiceFixtures';

test('a new conversation can retain a prior generated answer and follows its deletion', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const storage = createConversationArtifactStorage(connection.database);
    await storage.createSession(
      'parent-session',
      await storage.currentGeneration(),
    );
    const external = { ...reference, sourceKind: 'external_medical' as const };
    await storage.append({
      id: 'parent',
      sessionId: 'parent-session',
      createdAt: '2026-10-05T00:00:00.000Z',
      providerId: 'old-provider',
      modelId: 'old-model',
      status: 'complete',
      question: 'Old question',
      answer: 'Synthetic prior answer',
      sources: [{ reference: external, records: [] }],
      citations: [external],
    });
    const data = Object.assign(localData([]).data, {
      openConversationArtifactStorage: async () => storage,
      conversationArtifactDiscovery: async (
        registry: LocalEvidenceReferenceRegistry,
      ) =>
        createConversationArtifactDiscovery({
          database: connection.database,
          storage,
          data,
          registry,
        }),
    });
    const runner = jest.fn(
      async (options: Parameters<typeof runRagConversationTurn>[0]) => {
        const tool = options.workflow.tools.find(
          item => item.id === 'local-conversation-artifacts',
        )!;
        const result = await tool.search({
          operationRunId: 'run',
          operationKey: 'search',
          input: {
            query:
              options.question === 'Find saved child'
                ? 'Historical answer'
                : 'Synthetic',
          },
          allowedScope: { sourceKinds: ['generated_artifact'] },
          resultLimit: 1,
          maxPayloadBytes: 20000,
          signal: new AbortController().signal,
        });
        if ('status' in result || !result.items[0])
          throw new Error('Parent missing');
        const citation = referenceOnly(result.items[0]);
        options.onValidatedEvidence?.([citation]);
        return {
          status: 'answer' as const,
          answer: 'Historical answer',
          citations: [citation],
        };
      },
    ) as unknown as typeof runRagConversationTurn;
    const services = createAiFeatureServices(consent, {
      selectedAi: {
        selectionStore: selectionStore({
          providerId: apple.provider.id,
          modelId: apple.modelId,
        }),
        loadAppleOption: async () => apple,
      },
      loadLocalData: async () => data,
      ragRunner: runner,
    });
    const sessionOptions = services.conversationSessionOptions();
    const sessions = createConversationSessions(sessionOptions);
    sessions.setDraft(1, 'Find previous answer');
    await sessions.send(1, services.sendRagMessage);
    const firstSessionId = sessionOptions.retention!.activeIdentity(1)!;
    const firstTurnId = (await storage.list(firstSessionId)).items[0]!.id;
    expect((await storage.read(firstTurnId))?.answer).toBe('Historical answer');
    const restored = await createConversationArtifactDiscovery({
      database: connection.database,
      storage,
      data,
      registry: new LocalEvidenceReferenceRegistry(),
    }).read(firstTurnId);
    expect(restored?.sources[0]?.sourceKind).toBe('generated_artifact');
    expect(restored?.sourceStatus).toBe('unknown');
    const restoredSession = await sessionOptions.restoreSession!(
      firstSessionId,
      new AbortController().signal,
    );
    expect(restoredSession).toHaveLength(1);
    expect(restoredSession[0]?.answer).toBe('Historical answer');
    expect(restoredSession[0]?.citations[0]?.sourceKind).toBe(
      'generated_artifact',
    );
    sessions.create();
    sessions.setDraft(2, 'Find saved child');
    await sessions.send(2, services.sendRagMessage);
    const secondSessionId = sessionOptions.retention!.activeIdentity(2)!;
    const secondTurnId = (await storage.list(secondSessionId)).items[0]!.id;
    expect((await storage.read(secondTurnId))?.answer).toBe(
      'Historical answer',
    );
    const grandchild = await createConversationArtifactDiscovery({
      database: connection.database,
      storage,
      data,
      registry: new LocalEvidenceReferenceRegistry(),
    }).read(secondTurnId);
    expect(grandchild?.sourceStatus).toBe('unknown');
    await storage.deleteSession('parent-session');
    expect(await storage.read(firstTurnId)).toBeNull();
    expect(await storage.read(secondTurnId)).toBeNull();
    expect(
      (
        await connection.database.execute(
          'SELECT id FROM conversation_artifacts WHERE id = ?',
          [firstTurnId],
        )
      ).rows,
    ).toEqual([]);
    sessions.dispose();
  } finally {
    connection.close();
  }
});
