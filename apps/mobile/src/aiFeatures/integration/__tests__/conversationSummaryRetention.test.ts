import { createManualHistoryRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createSymptomSummaryStorage } from '../../../storage/symptomSummaryStorage';
import { createConversationSessionRetention } from '../../../ragConversation/conversationSessionRetention';
import { createConversationSessions } from '../../../ragConversation/conversationSessions';
import { referenceOnly } from '../../../diseaseHypotheses/resultValidation';
import { reference } from '../../../diseaseHypotheses/taskTestSupport';
import type { runRagConversationTurn } from '../../../ragConversation/service';
import { createSummaryArtifactDiscovery } from '../summaryArtifactDiscovery';
import { createConversationArtifactDiscovery } from '../conversationArtifactDiscovery';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { createAiFeatureServices } from '../featureServices';
import { fingerprint } from '../evidenceUtils';
import {
  apple,
  consent,
  localData,
  selectionStore,
} from '../featureServiceFixtures';

test('retains and reopens a conversation referencing a summary, then removes it with the source', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const history = createManualHistoryRepository(connection.database);
    const entry = await history.create({
      kind: 'note',
      title: 'Synthetic',
      details: 'Synthetic history',
      effectiveDate: { status: 'unknown' },
    });
    const evidence = await history.getEvidence(entry.id);
    const summary = createSymptomSummaryStorage(connection.database);
    await summary.append({
      id: 'summary',
      createdAt: '2026-10-05T00:00:00Z',
      modelName: 'Synthetic',
      modelId: 'model',
      providerId: 'provider',
      inputLineage: 'complete',
      analysis: {
        presentation: 'symptom_summary',
        hypotheses: [
          {
            title: 'Summary',
            summary: 'Synthetic prior interpretation',
            uncertainty: '',
            missingData: [],
            supportingEvidence: [reference],
            contraryEvidence: [],
          },
        ],
      },
      sources: [
        {
          reference,
          records: [
            {
              kind: 'manual_history',
              id: entry.id,
              revision: fingerprint(evidence),
            },
          ],
        },
      ],
    });
    const storage = createConversationArtifactStorage(connection.database);
    const data = Object.assign(localData([]).data, {
      manualHistory: history,
      summaryArtifactDiscovery: async (
        registry: LocalEvidenceReferenceRegistry,
      ) =>
        createSummaryArtifactDiscovery({
          database: connection.database,
          storage: summary,
          data,
          registry,
        }),
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
          item => item.id === 'local-generated-artifacts',
        )!;
        const result = await tool.search({
          operationRunId: 'run',
          operationKey: 'search',
          input: { query: 'Synthetic' },
          allowedScope: { sourceKinds: ['generated_artifact'] },
          resultLimit: 1,
          maxPayloadBytes: 20000,
          signal: new AbortController().signal,
        });
        if ('status' in result || !result.items[0])
          throw new Error('Summary missing');
        const citation = referenceOnly(result.items[0]);
        options.onValidatedEvidence?.([citation]);
        return {
          status: 'answer' as const,
          answer: 'Historical summary',
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
    let sequence = 0;
    const retention = createConversationSessionRetention({
      openStorage: async () => storage,
      createId: () => `id-${++sequence}`,
      now: () => '2026-10-05T00:00:00.000Z',
    });
    const sessions = createConversationSessions({ retention });
    sessions.setDraft(1, 'Find previous summary');
    await sessions.send(1, services.sendRagMessage);
    expect((await storage.read('id-2'))?.answer).toBe('Historical summary');
    const reopened = await createConversationArtifactDiscovery({
      database: connection.database,
      storage,
      data,
      registry: new LocalEvidenceReferenceRegistry(),
    }).read('id-2');
    expect(reopened?.sources[0]?.sourceKind).toBe('generated_artifact');
    await history.delete(entry.id);
    expect(await storage.read('id-2')).toBeNull();
    expect(
      (
        await connection.database.execute(
          'SELECT id FROM conversation_artifacts WHERE id = ?',
          ['id-2'],
        )
      ).rows,
    ).toEqual([]);
    sessions.dispose();
  } finally {
    connection.close();
  }
});
