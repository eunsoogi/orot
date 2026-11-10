import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import {
  createRecordRepository,
  runMigrations,
  readVisitQuestionRevision,
} from '@orot/storage';
import { AppointmentSchema } from '@orot/domain';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import {
  appointment,
  candidate,
  evidenceSpan,
  sourceRecord,
  input,
  repository,
} from '../../agent/visitQuestions/testing/persistenceFixtures';
import { saveReviewedVisitQuestions } from '../../agent/visitQuestions/persistence';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { notifyLocalSourceDeleted } from '../../storage/localDataClearEvents';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { manualVisitRestoreData } from '../testSupport/manualVisitRestoreData';
import { verifyManualVisitHealthKitRefresh } from '../testSupport/verifyManualVisitHealthKitRefresh';
import { prepareConversationVisitRetention } from '../../aiFeatures/integration/prepareConversationVisitRetention';
import { createVisitQuestionSourceService } from '../../aiFeatures/integration/visitQuestionSourceRegistration';
import { restoreConversationArtifact } from '../../aiFeatures/integration/restoreConversationArtifact';
import { restoreConversationVisitQuestions } from '../../aiFeatures/integration/restoreConversationVisitQuestions';
import { createConversationArtifactDiscovery } from '../../aiFeatures/integration/conversationArtifactDiscovery';
import { selectedVisitQuery } from '../../agent/visitQuestions/selectedVisitQuery';
import { loadSavedVisitQuestionState } from '../../aiFeatures/integration/savedVisitQuestions';
import { createInlineVisitReview } from '../../nextVisitQuestions/inlineVisitReview';
import { ConversationScreen } from '../ConversationScreen';
import {
  ConversationSessionsProvider,
  useConversationSessions,
} from '../ConversationSessionsContext';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import {
  createManualVisitRecords,
  openManualVisitRecords,
} from '../manualVisitRecordService';
import type { ConversationSessions } from '../conversationSessions';

jest.mock('../manualVisitRecordService', () => ({
  ...jest.requireActual('../manualVisitRecordService'),
  openManualVisitRecords: jest.fn(),
}));

test('restores a source-validated visit and its official answer after reopening SQLite and the conversation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'manual-visit-conversation-'));
  const path = join(directory, 'records.sqlite');
  let connection = openSqliteTestDatabase(path);
  const clock = jest
    .spyOn(Date, 'now')
    .mockReturnValue(Date.parse('2026-10-07T04:00:00.000Z'));
  try {
    await runMigrations(connection.database);
    let records = createRecordRepository(connection.database);
    await records.put('appointment', appointment);
    await records.put('source_record', sourceRecord as never);
    await records.put('evidence_span', evidenceSpan as never);
    let storage = createConversationArtifactStorage(connection.database);
    await storage.createSession('saved', await storage.currentGeneration());
    const registry = new LocalEvidenceReferenceRegistry();
    const data = manualVisitRestoreData(() => records);
    const register = createVisitQuestionSourceService(
      registry,
      async () => data,
    ).registerVisitQuestionSource;
    const result = {
      status: 'ready',
      appointment,
      review: createInlineVisitReview(
        'owner',
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
      registerSource: register,
    })(new AbortController().signal);
    await storage.append({
      id: 'turn',
      sessionId: 'saved',
      createdAt: '2026-10-05T00:00:00.000Z',
      status: 'complete',
      ...prepared,
    });
    const saved = await saveReviewedVisitQuestions({
      ...input(repository()),
      repository: records,
      questions: [candidate],
      expectedSavedQuestions: [],
    });
    const id = saved.questions[0]!.id;
    const manual = createManualVisitRecords(connection.database);
    await manual.saveManual({
      appointmentId: appointment.id,
      questionId: id,
      expectedQuestionRevision: (await readVisitQuestionRevision(
        connection.database,
        id,
      ))!,
      answer: '저장된 답변',
    });
    connection.close();
    connection = openSqliteTestDatabase(path);
    records = createRecordRepository(connection.database);
    storage = createConversationArtifactStorage(connection.database);
    (openManualVisitRecords as jest.Mock).mockResolvedValue(
      createManualVisitRecords(connection.database),
    );
    const freshRegistry = new LocalEvidenceReferenceRegistry();
    const discovery = createConversationArtifactDiscovery({
      database: connection.database,
      storage,
      registry: freshRegistry,
      data,
    });
    const makeOptions = () => ({
      retention: createConversationSessionRetention({
        openStorage: async () => storage,
        createId: () => 'new-turn',
        now: () => '2026-10-05T00:00:00.000Z',
      }),
      restoreSession: async () => {
        const restored = await restoreConversationArtifact({
          id: 'turn',
          storage,
          registry: freshRegistry,
          data,
          signal: new AbortController().signal,
        });
        if (!restored?.visitQuestions)
          throw new Error('Missing visit reference');
        const visitQuestions = await restoreConversationVisitQuestions({
          appointmentId: restored.visitQuestions.appointmentId,
          ownerKey: 'saved:turn',
          candidates: restored.visitQuestions.candidates,
          registry: freshRegistry,
          signal: new AbortController().signal,
          loadAppointment: async (_now, appointmentId) => {
            const query = selectedVisitQuery(
              {} as never,
              records,
              appointmentId,
            );
            const selection = await query.queryNextConfirmedCalendarAppointment(
              '2030-01-01T00:00:00.000Z',
            );
            return selection.appointment
              ? AppointmentSchema.parse(selection.appointment)
              : null;
          },
          loadSaved: appointmentId =>
            loadSavedVisitQuestionState({
              appointmentId,
              records,
              sourceReader: data.repository,
              registry: freshRegistry,
            }),
        });
        expect(visitQuestions).toBeNull();
        return [
          {
            question: restored.question,
            answer: restored.answer,
            citations: restored.citations ?? [],
            visitQuestionsUnavailable: true,
          },
        ];
      },
    });
    let current!: ConversationSessions;
    function Capture() {
      current = useConversationSessions();
      return null;
    }
    const view = await render(
      <ConversationSessionsProvider options={makeOptions()}>
        <Capture />
        <ConversationScreen
          onBack={jest.fn()}
          onOpenSource={jest.fn()}
          onSend={jest.fn()}
          {...({ discoverManualVisits: async () => discovery } as object)}
        />
      </ConversationSessionsProvider>,
    );
    await act(async () => {
      await current.attachExisting('saved', 0, '2026-10-05T00:00:00.000Z');
    });
    clock.mockRestore();
    await screen.findByText('저장된 답변');
    await verifyManualVisitHealthKitRefresh(records);
    await fireEvent.press(screen.getByText('저장'));
    await waitFor(() =>
      expect(screen.getByText('재열기 후 수정')).toBeTruthy(),
    );
    expect(
      (
        await createManualVisitRecords(connection.database).load(appointment.id)
      )[0].records[0].answer,
    ).toBe('재열기 후 수정');
    await fireEvent.press(screen.getByText('답변 수정'));
    await fireEvent.changeText(screen.getByLabelText('의료진 답변'), '초안');
    await act(async () => {
      await records.sourceRecords.delete(sourceRecord.id);
      notifyLocalSourceDeleted();
    });
    await waitFor(() =>
      expect(screen.queryByText('재열기 후 수정')).toBeNull(),
    );
    expect(screen.queryByLabelText('의료진 답변')).toBeNull();
    view.unmount();
  } finally {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
    jest.restoreAllMocks();
  }
});
