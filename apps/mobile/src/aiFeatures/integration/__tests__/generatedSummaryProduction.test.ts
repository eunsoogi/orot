import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createSymptomSummaryStorage } from '../../../storage/symptomSummaryStorage';
import { createConversationArtifactDiscovery } from '../conversationArtifactDiscovery';
import { createAiFeatureServices } from '../featureServices';
import { referenceOnly } from '../../../diseaseHypotheses/resultValidation';
import type { runDiseaseHypothesisAnalysis } from '../../../diseaseHypotheses/task';
import {
  apple,
  consent,
  localData,
  selectionStore,
} from '../featureServiceFixtures';

test.each([true, false])(
  'the %s summary action stores a generated conversation parent',
  async summary => {
    const connection = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(connection.database);
      const conversations = createConversationArtifactStorage(
        connection.database,
      );
      await conversations.createSession(
        'session',
        await conversations.currentGeneration(),
      );
      await conversations.append({
        id: 'private-turn',
        sessionId: 'session',
        createdAt: '2026-10-05T00:00:00.000Z',
        providerId: 'provider',
        modelId: 'model',
        status: 'complete',
        question: 'Synthetic question',
        answer: 'Synthetic history',
        sources: [],
        citations: [],
      });
      const storage = createSymptomSummaryStorage(connection.database);
      const data = Object.assign(localData([]).data, {
        conversationArtifactDiscovery: async (
          registry: import('../evidenceRegistry').LocalEvidenceReferenceRegistry,
        ) =>
          createConversationArtifactDiscovery({
            database: connection.database,
            storage: conversations,
            data,
            registry,
          }),
      });
      const runner = jest.fn(
        async (options: Parameters<typeof runDiseaseHypothesisAnalysis>[0]) => {
          expect(options.execution.allowedScope.sourceKinds).toContain(
            'generated_artifact',
          );
          expect(options.execution.consentScope?.dataCategories).toContain(
            'generated_artifacts',
          );
          const tool = options.tools.find(
            item => item.id === 'local-conversation-artifacts',
          )!;
          const batch = await tool.search({
            operationRunId: options.execution.operationRunId,
            operationKey: 'search',
            input: { query: 'Synthetic' },
            allowedScope: { sourceKinds: ['generated_artifact'] },
            resultLimit: 1,
            maxPayloadBytes: 20000,
            signal: new AbortController().signal,
          });
          if ('status' in batch || !batch.items[0])
            throw new Error('Missing parent');
          const citation = referenceOnly(batch.items[0]);
          return {
            status: 'workflow',
            result: {
              status: 'result',
              value: {
                ...(summary ? { presentation: 'symptom_summary' } : {}),
                hypotheses: [
                  {
                    title: 'Earlier result',
                    summary: 'A previous AI answer.',
                    uncertainty: 'Unknown',
                    missingData: [],
                    supportingEvidence: [citation],
                    contraryEvidence: [],
                  },
                ],
              },
              checkpoint: { evidenceReferences: [citation] },
            },
          } as never;
        },
      );
      const services = createAiFeatureServices(consent, {
        selectedAi: {
          selectionStore: selectionStore({
            providerId: apple.provider.id,
            modelId: apple.modelId,
          }),
          loadAppleOption: async () => apple,
        },
        loadLocalData: async () => data,
        summaryStorage: async () => storage,
        diseaseRunner: runner,
      });
      const outcome = summary
        ? await services.summarizeSymptoms!()
        : await services.generateDiseaseHypotheses();
      if (outcome.status !== 'workflow' || outcome.result.status !== 'result')
        throw new Error('No result');
      expect(outcome.result.value.savedSummary?.status).toBe('saved');
      const savedId =
        outcome.result.value.savedSummary!.status === 'saved'
          ? outcome.result.value.savedSummary!.id
          : '';
      const saved = await storage.read(savedId);
      expect(saved?.sources).toEqual([
        expect.objectContaining({
          kind: 'generated_conversation',
          id: 'private-turn',
        }),
      ]);
      await conversations.deleteSession('session');
      expect(await storage.read(savedId)).toBeNull();
    } finally {
      connection.close();
    }
  },
);
