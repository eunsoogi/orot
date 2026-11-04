import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createSymptomSummaryStorage } from '../../../storage/symptomSummaryStorage';
import { createConversationArtifactDiscovery } from '../conversationArtifactDiscovery';
import { createAiFeatureServices } from '../featureServices';
import { localData, consent, selectionStore } from '../featureServiceFixtures';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';
import {
  makeProvider,
  selectedOption,
} from '../../../agent/visitQuestions/testing/workflowFixtures';

test.each(['disease', 'summary'] as const)(
  '%s workflow searches a prior answer and saves its actual generated lineage',
  async mode => {
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
      await conversations.createSession(
        'other-session',
        await conversations.currentGeneration(),
      );
      await conversations.append({
        id: 'other-turn',
        sessionId: 'other-session',
        createdAt: '2026-10-04T00:00:00.000Z',
        providerId: 'provider',
        modelId: 'model',
        status: 'complete',
        question: 'Synthetic earlier question',
        answer: 'Synthetic earlier history',
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
      const alias = {
        sourceKind: 'generated_artifact',
        sourceId: 's1',
        sourceRevision: 'sr1',
        evidenceId: 'e1',
        evidenceRevision: 'er1',
        locator: { kind: 'local-evidence', token: 'e1' },
        effectiveTime: null,
        reviewState: 'unreviewed',
      };
      const section = {
        title: '이전 결과 검토',
        summary: '이전 AI 결과를 진료에서 검토할 수 있어요.',
        uncertainty: '기록의 구체적인 경과가 부족해요.',
        missingData: [],
        supportingEvidence: ['e1'],
        contraryEvidence: [],
      };
      const outputs = [
        JSON.stringify({
          text: '',
          toolCalls: [
            {
              id: 'records',
              name: 'local-personal-records',
              arguments: { query: 'Synthetic' },
            },
          ],
          finishReason: 'tool_calls',
        }),
        JSON.stringify({
          text: '',
          toolCalls: [
            {
              id: 'search',
              name: 'local-conversation-artifacts',
              arguments: { query: 'Synthetic' },
            },
          ],
          finishReason: 'tool_calls',
        }),
        JSON.stringify({
          type: 'result',
          value:
            mode === 'summary'
              ? { sections: [section] }
              : { hypotheses: [section] },
          citations: [alias],
        }),
      ];
      const { provider, requests } = makeProvider(outputs);
      const { selection, option } = selectedOption(
        { ...provider, searchPublicWeb: publicEvidenceFixture().search },
        'selected-context-remote',
      );
      const services = createAiFeatureServices(consent, {
        selectedAi: {
          selectionStore: selectionStore(selection),
          loadAppleOption: async () => option,
        },
        loadLocalData: async () => data,
        summaryStorage: async () => storage,
        externalEvidence: { search: async () => ({ status: 'empty' }) },
        externalQueryConsent: { authorize: async () => 'authorized' },
      });
      const outcome =
        mode === 'summary'
          ? await services.summarizeSymptoms!()
          : await services.generateDiseaseHypotheses();
      if (outcome.status === 'workflow' && outcome.result.status !== 'result')
        throw new Error(JSON.stringify(outcome.result));
      expect(outcome).toMatchObject({
        status: 'workflow',
        result: {
          status: 'result',
          value: { savedSummary: { status: 'saved' } },
        },
      });
      if (
        outcome.status !== 'workflow' ||
        outcome.result.status !== 'result' ||
        outcome.result.value.savedSummary?.status !== 'saved'
      )
        throw new Error('No saved result');
      const saved = await storage.read(outcome.result.value.savedSummary.id);
      expect(saved?.sources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'generated_conversation',
            id: 'private-turn',
          }),
          expect.objectContaining({
            kind: 'generated_conversation',
            id: 'other-turn',
          }),
        ]),
      );
      expect(JSON.stringify(requests)).not.toContain('private-turn');
      expect(JSON.stringify(requests)).not.toContain('other-turn');
      expect(requests).toHaveLength(3);
      const cited = services.resolveSource(
        outcome.result.value.hypotheses[0]!.supportingEvidence[0]!,
      );
      await conversations.deleteSession(
        cited?.sourceId === 'private-turn' ? 'other-session' : 'session',
      );
      expect(await storage.read(saved!.id)).toBeNull();
    } finally {
      connection.close();
    }
  },
);
