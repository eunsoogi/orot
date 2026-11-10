import * as appointmentLoader from '../visitQuestionAppointment';
import {
  healthContextFixture,
  window,
} from '../testSupport/healthContextPersistenceFixture';
import {
  appointment,
  candidate,
  evidenceSpan,
  sourceRecord,
} from '../../../agent/visitQuestions/testing/persistenceFixtures';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';
import { createConversationArtifactDiscovery } from '../conversationArtifactDiscovery';
import { createConversationSessionOptions } from '../conversationSessionOptions';
import { restoreHealthSummary } from '../restoreHealthSummary';
import { prepareConversationVisitRetention } from '../prepareConversationVisitRetention';
import { createVisitQuestionSourceService } from '../visitQuestionSourceRegistration';
import { createInlineVisitReview } from '../../../nextVisitQuestions/inlineVisitReview';

test('restores saved summary and source-backed question candidate in one session', async () => {
  jest
    .spyOn(Date, 'now')
    .mockReturnValue(Date.parse('2026-10-07T04:00:00.000Z'));
  const f = await healthContextFixture();
  try {
    await f.repository.put('appointment', appointment);
    jest
      .spyOn(appointmentLoader, 'loadVisitQuestionAppointment')
      .mockImplementation(
        async (_now, id) =>
          (await f.repository.get('appointment', id!)) ?? null,
      );
    await f.repository.put('source_record', sourceRecord as never);
    await f.repository.put('evidence_span', evidenceSpan as never);
    await f.storage.append(f.saved);
    const storage = createConversationArtifactStorage(f.database);
    await storage.createSession('session', await storage.currentGeneration());
    const registry = new LocalEvidenceReferenceRegistry();
    const data = {
      ...localData([]).data,
      readHealthContext: f.read,
      repository: {
        readRecord: async (
          kind: Parameters<typeof f.repository.get>[0],
          id: string,
        ) => f.repository.get(kind, id),
        querySource: async () => ({
          status: 'available',
          complete: true,
          records: [
            {
              kind: 'source_record',
              record: (await f.repository.get(
                'source_record',
                sourceRecord.id,
              ))!,
            },
            {
              kind: 'evidence_span',
              record: (await f.repository.get(
                'evidence_span',
                evidenceSpan.id,
              ))!,
            },
          ],
        }),
      } as never,
    };
    const registerSource = createVisitQuestionSourceService(
      registry,
      async () => data,
    ).registerVisitQuestionSource;
    const result = {
      status: 'ready',
      appointment,
      review: createInlineVisitReview(
        'session:visit',
        [],
        [candidate],
        [],
        () => candidate.identity!.id,
      ),
      selectedAi: { provider: { id: 'provider' }, modelId: 'model' },
      generation: {
        status: 'ready',
        questions: [candidate],
        caveats: [],
        validateSource: async () => true,
      },
    } as unknown as Parameters<
      typeof prepareConversationVisitRetention
    >[0]['result'];
    const prepared = await prepareConversationVisitRetention({
      result,
      question: '진료 질문',
      answer: '준비했어요',
      loadLocalData: async () => data,
      registry,
      registerSource,
    })(new AbortController().signal);
    await storage.append({
      id: 'summary',
      sessionId: 'session',
      createdAt: '2026-10-05T00:00:00.000Z',
      providerId: 'provider',
      modelId: 'model',
      status: 'complete',
      question: '요약',
      answer: '요약 결과',
      sources: [],
      citations: [],
      healthSummary: { summaryId: f.saved.id, window },
    });
    await storage.append({
      id: 'visit',
      sessionId: 'session',
      createdAt: '2026-10-06T00:00:00.000Z',
      status: 'complete',
      ...prepared,
    });
    const restoredData = {
      ...data,
      openConversationArtifactStorage: async () => storage,
      conversationArtifactDiscovery: async (
        fresh: LocalEvidenceReferenceRegistry,
      ) =>
        createConversationArtifactDiscovery({
          database: f.database,
          storage,
          registry: fresh,
          data,
        }),
    };
    const options = createConversationSessionOptions({
      loadLocalData: async () => restoredData,
      registry,
      restoreHealthSummary: ref =>
        restoreHealthSummary({
          reference: ref,
          storage: f.storage,
          registry,
          data,
        }),
      loadSavedVisitQuestions: async () =>
        ({
          status: 'ready',
          appointmentId: appointment.id,
          questions: [],
          caveats: [],
        }) as never,
    });
    const turns = await options.restoreSession!(
      'session',
      new AbortController().signal,
    );
    expect(
      turns.find(turn => turn.toolMessageId === 'summary')?.healthSummary
        ?.analysis.savedSummary,
    ).toMatchObject({ status: 'saved', id: f.saved.id });
    expect(
      turns.find(turn => turn.toolMessageId === 'visit')?.visitQuestions?.review
        .items[0]?.question.identity?.id,
    ).toBe(candidate.identity?.id);
  } finally {
    f.close();
    jest.restoreAllMocks();
  }
});
