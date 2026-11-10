import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import {
  appointment,
  candidate,
  citation,
  evidenceSpan,
  sourceRecord,
  input,
  repository,
} from '../../../agent/visitQuestions/testing/persistenceFixtures';
import { saveReviewedVisitQuestions } from '../../../agent/visitQuestions/persistence';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';
import { restoreConversationArtifact } from '../restoreConversationArtifact';
import { restoreConversationVisitQuestions } from '../restoreConversationVisitQuestions';
import { prepareConversationVisitRetention } from '../prepareConversationVisitRetention';
import { createVisitQuestionSourceService } from '../visitQuestionSourceRegistration';
import { createInlineVisitReview } from '../../../nextVisitQuestions/inlineVisitReview';
import { loadSavedVisitQuestionState } from '../savedVisitQuestions';

test('reopens a source-backed visit candidate from SQLite and refuses a changed appointment', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-visit-turn-'));
  const path = join(directory, 'records.sqlite');
  let connection = openSqliteTestDatabase(path);
  jest
    .spyOn(Date, 'now')
    .mockReturnValue(Date.parse('2026-10-07T04:00:00.000Z'));
  try {
    await runMigrations(connection.database);
    let records = createRecordRepository(connection.database);
    await records.put('appointment', appointment);
    await records.put('source_record', sourceRecord as never);
    await records.put('evidence_span', evidenceSpan as never);
    let storage = createConversationArtifactStorage(connection.database);
    await storage.createSession('session', await storage.currentGeneration());
    const registry = new LocalEvidenceReferenceRegistry();
    const data = {
      ...localData([]).data,
      repository: {
        readRecord: async (
          kind: Parameters<typeof records.get>[0],
          id: string,
        ) => records.get(kind, id),
        querySource: async () => ({
          status: 'available',
          complete: true,
          records: [
            {
              kind: 'source_record',
              record: (await records.get('source_record', sourceRecord.id))!,
            },
            {
              kind: 'evidence_span',
              record: (await records.get('evidence_span', evidenceSpan.id))!,
            },
          ],
        }),
      } as never,
    };
    const register = createVisitQuestionSourceService(
      registry,
      async () => data,
    ).registerVisitQuestionSource;
    const generatedReview = createInlineVisitReview(
      'session:turn',
      [],
      [candidate],
      [],
      () => candidate.identity!.id,
    );
    const result = {
      status: 'ready',
      appointment,
      review: generatedReview,
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
      question: '진료 질문을 준비해 주세요',
      answer: '준비했어요',
      loadLocalData: async () => data,
      registry,
      registerSource: register,
    })(new AbortController().signal);
    await storage.append({
      id: 'turn',
      sessionId: 'session',
      createdAt: '2026-10-05T00:00:00.000Z',
      status: 'complete',
      ...prepared,
    });
    await saveReviewedVisitQuestions({
      ...input(repository()),
      repository: records,
      questions: [
        { ...candidate, questionText: '저장한 수정 질문을 확인할까요?' },
      ],
      expectedSavedQuestions: [],
    });
    connection.close();
    connection = openSqliteTestDatabase(path);
    records = createRecordRepository(connection.database);
    storage = createConversationArtifactStorage(connection.database);
    const freshRegistry = new LocalEvidenceReferenceRegistry();
    const restored = await restoreConversationArtifact({
      id: 'turn',
      storage,
      registry: freshRegistry,
      data,
      signal: new AbortController().signal,
    });
    expect(restored?.visitQuestions?.candidates[0]?.identity?.id).toBe(
      candidate.identity?.id,
    );
    expect(
      restored?.visitQuestions?.candidates[0]?.citations[0]?.sourceId,
    ).not.toBe(citation.sourceId);
    const review = await restoreConversationVisitQuestions({
      appointmentId: appointment.id,
      ownerKey: 'session:turn',
      candidates: restored!.visitQuestions!.candidates,
      registry: freshRegistry,
      signal: new AbortController().signal,
      loadAppointment: async () =>
        await records.get('appointment', appointment.id),
      loadSaved: appointmentId =>
        loadSavedVisitQuestionState({
          appointmentId,
          records,
          sourceReader: data.repository,
          registry: freshRegistry,
        }),
    });
    expect(review?.review.items[0]?.question.identity?.id).toBe(
      candidate.identity?.id,
    );
    expect(review?.review.items).toHaveLength(1);
    expect(review?.review.items[0]).toMatchObject({
      selected: true,
      origin: 'saved',
      question: { questionText: '저장한 수정 질문을 확인할까요?' },
    });
    await records.put('appointment', {
      ...appointment,
      clinicLabel: 'changed',
    });
    expect(
      await restoreConversationArtifact({
        id: 'turn',
        storage,
        registry: freshRegistry,
        data,
        signal: new AbortController().signal,
      }),
    ).toBeNull();
  } finally {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
    jest.restoreAllMocks();
  }
});
