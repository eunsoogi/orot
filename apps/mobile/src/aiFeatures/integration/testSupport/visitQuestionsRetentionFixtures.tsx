import { fireEvent, render, waitFor } from '@testing-library/react-native';
import App from '../../../../App';
import {
  apple,
  localData,
  memoryRecord,
  selectionStore,
} from '../featureServiceFixtures';
import { NextVisitQuestionsRoute } from '../NextVisitQuestionsRoute';
import { AiFeatureRoute } from '../AiFeatureRoute';
import type { AiFeatureServiceDependencies } from '../featureServices';
import type {
  VisitQuestionRouteGeneration,
  VisitQuestionRouteOperations,
} from '../visitQuestionsRouteOperations';
const selection = {
  providerId: apple.provider.id,
  modelId: apple.modelId,
};
export const appointment = {
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

export function readyQuestions(): Extract<
  VisitQuestionRouteGeneration,
  { status: 'ready' }
> {
  const citation = {
    sourceKind: 'personal_record' as const,
    sourceId: 'synthetic-record',
    sourceRevision: '1',
    evidenceId: 'synthetic-evidence',
    evidenceRevision: '1',
    locator: { kind: 'structured_record', recordId: 'synthetic-record' },
    effectiveTime: '2035-05-01T00:00:00.000Z',
    reviewState: 'reviewed' as const,
    content: '합성 혈압 기록',
  };
  return {
    status: 'ready',
    questions: [
      '혈압 변화를 확인하는 합성 질문',
      '최근 증상과 기록을 연결하는 합성 질문',
      '추세의 불확실성을 확인하는 합성 질문',
    ].map(questionText => ({
      questionText,
      rationale: '합성 근거의 변화를 확인합니다.',
      priority: 'important',
      citations: [citation],
    })),
    caveats: [],
    validateSource: async () => true,
  };
}

export function createOperations(
  generate: VisitQuestionRouteOperations['generate'],
): VisitQuestionRouteOperations {
  return {
    loadAppointment: jest.fn(async () => appointment),
    generate: jest.fn(generate),
    save: jest.fn(async input => ({
      questions: input.questions,
      caveats: input.caveats,
      memoryStatus: 'saved' as const,
      validateSource: async () => true,
    })),
  };
}

export async function renderIntegratedRoute(
  operations: VisitQuestionRouteOperations,
  app = false,
) {
  const data = localData([memoryRecord(1)]).data;
  const serviceDependencies: AiFeatureServiceDependencies = {
    selectedAi: {
      selectionStore: selectionStore(selection),
      loadAppleOption: async () => apple,
    },
    loadLocalData: async () => data,
  };
  const renderVisitQuestions = (
    input: import('../AiFeatureFlowScreen').VisitQuestionsRenderInput,
  ) => (
    <NextVisitQuestionsRoute
      {...input}
      loadSavedVisitQuestions={async appointmentId => ({
        status: 'ready' as const,
        appointmentId,
        questions: [],
        caveats: [],
        restorationNotice: '합성 복원 결과',
      })}
      operations={operations}
    />
  );
  const route = await render(
    app ? (
      <App
        renderVisitQuestions={renderVisitQuestions}
        aiFeatureServiceDependencies={serviceDependencies}
      />
    ) : (
      <AiFeatureRoute
        onBack={jest.fn()}
        renderVisitQuestions={renderVisitQuestions}
        serviceDependencies={serviceDependencies}
      />
    ),
  );
  if (app) await fireEvent.press(route.getByTestId('navigation-tab-ai'));
  return route;
}
export async function startGeneration(
  route: Awaited<ReturnType<typeof render>>,
) {
  await fireEvent.press(route.getByTestId('ai-feature-visit-questions'));
  await waitFor(() => expect(route.getByText('합성 예약')).toBeTruthy());
  await waitFor(() =>
    expect(route.getByTestId('next-visit-provider-select')).toHaveTextContent(
      /Apple Intelligence/u,
    ),
  );
  await fireEvent.press(route.getByTestId('next-visit-generate'));
  await waitFor(() =>
    expect(route.getByTestId('next-visit-generation-loading')).toBeTruthy(),
  );
}
