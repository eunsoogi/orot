import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createConversationArtifactDiscovery } from '../conversationArtifactDiscovery';
import { createAiFeatureServices } from '../featureServices';
import { localData, consent } from '../featureServiceFixtures';
import { defaultVisitQuestionRouteOperations } from '../visitQuestionsRouteOperations';
import * as contextLoader from '../visitQuestionsContextLoader';
import { saveReviewedVisitQuestions } from '../../../agent/visitQuestions/persistence';
import { localEvidenceFingerprint } from '../../../agent/visitQuestions/evidence';
import { saveVisitQuestionRoute } from '../visitQuestionsRouteSave';
import { referenceOnly } from '../../../diseaseHypotheses/resultValidation';
import { createVisitQuestionEvidenceAliases } from '../../../agent/visitQuestions/evidenceAliases';
import {
  makeProvider,
  preparedContext,
  selectedOption,
} from '../../../agent/visitQuestions/testing/workflowFixtures';

test.each(['on-device', 'selected-context-remote'] as const)(
  'visit production uses generated conversation with %s processing',
  async privacy => {
    const connection = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(connection.database);
      const storage = createConversationArtifactStorage(connection.database);
      await storage.createSession('session', await storage.currentGeneration());
      await storage.append({
        id: 'private-turn',
        sessionId: 'session',
        createdAt: '2026-10-05T00:00:00.000Z',
        providerId: 'provider',
        modelId: 'model',
        status: 'complete',
        question: 'Synthetic question',
        answer: 'Synthetic examination result',
        sources: [],
        citations: [],
      });
      await storage.createSession(
        'uncited-session',
        await storage.currentGeneration(),
      );
      await storage.append({
        id: 'uncited-turn',
        sessionId: 'uncited-session',
        createdAt: '2026-10-04T00:00:00.000Z',
        providerId: 'provider',
        modelId: 'model',
        status: 'complete',
        question: 'Synthetic earlier question',
        answer: 'Synthetic earlier result',
        sources: [],
        citations: [],
      });
      const data = Object.assign(localData([]).data, {
        conversationArtifactDiscovery: async (
          registry: import('../evidenceRegistry').LocalEvidenceReferenceRegistry,
        ) =>
          createConversationArtifactDiscovery({
            database: connection.database,
            storage,
            data,
            registry,
          }),
      });
      const services = createAiFeatureServices(consent, {
        loadLocalData: async () => data,
      });
      const generated = await services.generatedArtifactTools!();
      const prepared = preparedContext();
      const alias = createVisitQuestionEvidenceAliases(
        prepared.evidence.batch,
      ).aliasBatch({
        items: [
          {
            sourceKind: 'generated_artifact',
            sourceId: 's1',
            sourceRevision: 'sr1',
            evidenceId: 'e1',
            evidenceRevision: 'er1',
            locator: { kind: 'local-evidence', token: 'e1' },
            effectiveTime: null,
            reviewState: 'unreviewed',
            content: 'Synthetic',
          },
        ],
        coverage: [],
        conflicts: [],
      }).items[0]!;
      const citation = referenceOnly(alias);
      const questions = [
        '이전 결과를 어떻게 확인할까요?',
        '이 결과에서 살펴볼 점이 있나요?',
        '다음 진료에 무엇을 준비할까요?',
      ].map(questionText => ({
        questionText,
        rationale: '이전 AI 결과를 의료진과 확인할 수 있어요.',
        priority: 'routine',
        evidenceIds: [citation.evidenceId],
      }));
      const outputs = [
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
          value: { status: 'suggestions', questions },
          citations: [citation],
        }),
      ];
      const { provider, requests } = makeProvider(outputs);
      const { selection, option } = selectedOption(provider, privacy);
      const loader = jest
        .spyOn(contextLoader, 'loadVisitQuestionsContext')
        .mockResolvedValue({
          prepareUpcomingVisitQuestionContext: async () => prepared,
        } as never);
      const controller = new AbortController();
      const authorize = jest.fn(async () => true);
      const result = await defaultVisitQuestionRouteOperations.generate({
        appointment: prepared.appointment,
        selectedAi: {
          status: 'ready',
          selection,
          option,
          provider,
          modelId: selection.modelId,
          recipient: privacy === 'on-device' ? 'on-device' : 'selected-account',
          remoteProcessing: privacy !== 'on-device',
        },
        confirmConsent: authorize,
        signal: controller.signal,
        generatedArtifactTools: services.generatedArtifactTools,
      });
      loader.mockRestore();
      controller.abort();
      expect(result.status).toBe('ready');
      if (privacy !== 'on-device')
        expect(authorize).toHaveBeenCalledWith(
          expect.objectContaining({
            consentScope: expect.objectContaining({
              dataCategories: expect.arrayContaining(['generated_artifacts']),
              policyVersion: 'local-artifacts-v1',
            }),
          }),
        );
      if (result.status !== 'ready') throw new Error('No generated question');
      const source = result.questions[0]!.citations[0]!;
      expect(
        await result.validateSource(source, new AbortController().signal),
      ).toBe(true);
      expect(services.resolveSource(source)).toMatchObject({
        sourceKind: 'generated_artifact',
        sourceId: 'uncited-turn',
      });
      expect(JSON.stringify(requests)).not.toContain('private-turn');
      expect(JSON.stringify(requests)).not.toContain('uncited-turn');
      expect(result.questions[0]?.generatedArtifactContext).toHaveLength(2);
      expect(
        await generated.validate([source], new AbortController().signal),
      ).toBe(true);
      const records = createRecordRepository(connection.database);
      await records.put('appointment', prepared.appointment);
      const saved = await saveVisitQuestionRoute(
        {
          appointment: prepared.appointment,
          questions: result.questions,
          caveats: [],
          resolveSource: services.resolveSource,
          validateGeneratedArtifact: async (reference, signal) =>
            generated.validate([reference], signal),
        },
        async () => ({
          prepareUpcomingVisitQuestionContext: async options => {
            const evidence = {
              batch: { items: [], coverage: [], conflicts: [] },
              metadataByCitation: new Map(),
              memoryStatus: 'no_matching_current_memory' as const,
            };
            const revalidateEvidence = async (
              items: (typeof result.questions)[number]['citations'],
            ) =>
              (
                await Promise.all(
                  items.map(item =>
                    options.validateGeneratedArtifact!(item, {} as never),
                  ),
                )
              ).every(Boolean);
            return {
              ...prepared,
              evidence,
              revalidateEvidence,
              saveReviewedQuestions: (
                reviewed: readonly import('../../../agent/visitQuestions/taskContract').VisitQuestionCandidate[],
              ) =>
                saveReviewedVisitQuestions({
                  appointmentId: prepared.appointment.id,
                  expectedAppointmentRevision: localEvidenceFingerprint(
                    prepared.appointment,
                  ),
                  questions: reviewed,
                  evidence,
                  repository: records,
                  now: '2026-10-07T04:00:00.000Z',
                  revalidateEvidence,
                }),
            } as never;
          },
        }),
      );
      expect(saved.questions).toHaveLength(3);
      const questionId = `visit-question:${prepared.appointment.id}:1`;
      expect(await records.get('visit_question', questionId)).toMatchObject({
        generatedArtifactSources: expect.arrayContaining([
          expect.objectContaining({
            kind: 'generated_conversation',
            id: 'private-turn',
          }),
          expect.objectContaining({
            kind: 'generated_conversation',
            id: 'uncited-turn',
          }),
        ]),
      });
      await storage.deleteSession('session');
      expect(await records.get('visit_question', questionId)).toBeNull();
      await storage.deleteSession('uncited-session');
      expect(
        await generated.validate([source], new AbortController().signal),
      ).toBe(false);
      expect(await records.get('visit_question', questionId)).toBeNull();
    } finally {
      connection.close();
    }
  },
);
