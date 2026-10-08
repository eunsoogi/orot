import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { EvidenceItem } from '@orot/agent-runtime';
import { createAppleSelectionOption } from '../../../providers/selection/options';
import type { ProviderSelection } from '../../../providers/selection';
import type { VisitQuestionEvidenceItem } from '../../../agent/visitQuestions/taskContract';
import type { NextVisitQuestionsRouteProps } from '../NextVisitQuestionsRoute';
import { NextVisitQuestionsRoute } from '../NextVisitQuestionsRoute';
import type { VisitQuestionRouteOperations } from '../visitQuestionsRouteOperations';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

const option = createAppleSelectionOption('available');
const selection: ProviderSelection = {
  providerId: option.provider.id,
  modelId: option.modelId,
};
const appointment = {
  id: 'synthetic-visit-1',
  effectiveAt: '2035-06-02T09:30:00.000Z',
  recordedAt: '2035-01-01T00:00:00.000Z',
  ingestedAt: '2035-01-01T00:00:00.000Z',
  provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' as const },
  status: 'scheduled' as const,
  calendarEventIdentifier: 'synthetic-calendar-event',
  calendarEventSnapshot: {
    title: '합성 예약',
    timeZoneIdentifier: 'Asia/Seoul',
    isAllDay: false,
    occurrenceDate: null,
    isDetached: false,
    recurrenceRules: [],
  },
};
const citation: VisitQuestionEvidenceItem = {
  sourceKind: 'personal_record',
  sourceId: 'synthetic-source-1',
  sourceRevision: 'source-revision-1',
  evidenceId: 'synthetic-evidence-1',
  evidenceRevision: 'evidence-revision-1',
  locator: { kind: 'evidence_span', evidenceSpanId: 'synthetic-evidence-1' },
  effectiveTime: '2035-05-20T09:00:00.000Z',
  reviewState: 'reviewed',
  content: '합성 건강 기록의 근거 문장',
};
const reviewedQuestion = {
  questionText: '최근 증상 변화를 어떻게 정리할까요?',
  rationale: '기록된 변화의 시점을 의료진과 확인합니다.',
  priority: 'routine' as const,
  citations: [citation],
};

test('renders the visit route with selected AI, generation, source, and save actions', async () => {
  // Synthetic operation results verify screen wiring; production data adapters are tested separately.
  const validateSource = jest.fn(async () => true);
  const save = jest.fn(
    async (input: Parameters<VisitQuestionRouteOperations['save']>[0]) => ({
      questions: input.questions,
      caveats: input.caveats,
      memoryStatus: 'saved' as const,
      validateSource,
    }),
  );
  const generate = jest.fn(async () => ({
    status: 'ready' as const,
    questions: [
      reviewedQuestion,
      {
        ...reviewedQuestion,
        questionText: '복용 기록의 시점을 어떻게 확인할까요?',
      },
      { ...reviewedQuestion, questionText: '추가로 확인할 자료가 있을까요?' },
    ],
    caveats: ['conflicting_records' as const],
    validateSource,
  }));
  const operations: VisitQuestionRouteOperations = {
    loadAppointment: jest.fn(async () => appointment),
    generate,
    save,
  };
  const resolveSelectedAi = jest.fn(async () => ({
    status: 'ready' as const,
    selection,
    option,
    provider: option.provider,
    modelId: option.modelId,
    recipient: '기기 안의 Apple Intelligence',
    remoteProcessing: false,
  }));
  const confirmConsent = jest.fn(async () => true);
  const onOpenSource = jest.fn();
  const registeredSource: EvidenceItem = {
    ...citation,
    sourceId: 's1',
    evidenceId: 'e1',
  };
  const registerVisitQuestionSource = jest.fn(() => registeredSource);
  const props: NextVisitQuestionsRouteProps = {
    onBack: jest.fn(),
    onOpenProviderSelection: jest.fn(),
    onOpenSource,
    onRouteStateChange: jest.fn(),
    resolveSelectedAi,
    confirmConsent,
    resolveSource: jest.fn(() => undefined),
    registerVisitQuestionSource,
    selectedAiRevision: 0,
    loadSavedVisitQuestions: jest.fn(async appointmentId => ({
      status: 'ready' as const,
      appointmentId,
      questions: [],
      caveats: [] as const,
      restorationNotice: '이전 생성 경고는 저장되지 않았습니다.',
    })),
    operations,
  };

  await render(<NextVisitQuestionsRoute {...props} />);
  await waitFor(() => expect(screen.getByText('합성 예약')).toBeTruthy());
  await waitFor(() =>
    expect(screen.getByText('Apple Intelligence')).toBeTruthy(),
  );
  await fireEvent.press(screen.getByTestId('next-visit-generate'));
  await waitFor(() =>
    expect(screen.getByTestId('next-visit-review-list')).toBeTruthy(),
  );

  expect(generate).toHaveBeenCalledWith(
    expect.objectContaining({
      appointment,
      selectedAi: expect.objectContaining({ selection }),
      confirmConsent,
      signal: expect.anything(),
    }),
  );
  expect(props.onRouteStateChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ hasUnsavedChanges: true, isSaving: false }),
  );

  await fireEvent.press(screen.getByTestId('next-visit-source-0-0'));
  expect(registerVisitQuestionSource).toHaveBeenCalledWith(
    citation,
    expect.any(Function),
  );
  expect(onOpenSource).toHaveBeenCalledWith(registeredSource);
  await fireEvent.press(screen.getByTestId('next-visit-source-close'));

  await fireEvent.press(screen.getByTestId('next-visit-review-save'));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ appointment })),
  );
  await waitFor(() =>
    expect(screen.getByTestId('next-visit-save-message')).toHaveTextContent(
      '검토한 질문을 이 예약에 저장했어요.',
    ),
  );
  await fireEvent.press(screen.getByTestId('next-visit-questions-back'));
  expect(props.onBack).toHaveBeenCalledTimes(1);
});
