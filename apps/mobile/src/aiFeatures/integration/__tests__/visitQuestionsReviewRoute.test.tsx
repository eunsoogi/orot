import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { saveVisitQuestionRoute } from '../visitQuestionsRouteSave';
import type { VisitQuestionRouteGeneration } from '../visitQuestionsRouteOperations';
import type { VisitQuestionCandidate } from '../../../agent/visitQuestions/taskContract';
import {
  appointment,
  createOperations,
  readyQuestions,
  renderIntegratedRoute,
  startGeneration,
} from '../testSupport/visitQuestionsRetentionFixtures';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../../providers/selection/options', () => {
  const actual = jest.requireActual('../../../providers/selection/options');
  return {
    ...actual,
    loadAppleSelectionOption: jest.fn(async () =>
      actual.createAppleSelectionOption('available'),
    ),
  };
});

test('saves the reviewed draft through the session and route, then discards a later edit', async () => {
  let finish!: (value: VisitQuestionRouteGeneration) => void;
  const generated = readyQuestions();
  const citation = generated.questions[0]!.citations[0]!;
  const receive = jest.fn(
    async (questions: readonly VisitQuestionCandidate[]) => ({
      questions: questions.map(question => ({
        ...question,
        id: question.identity!.id,
      })),
      memoryStatus: 'saved' as const,
    }),
  );
  const context = {
    status: 'ready' as const,
    appointment,
    evidence: { batch: { items: [citation] } },
    saveReviewedQuestions: receive,
    revalidateEvidence: jest.fn(async () => true),
  };
  const operations = createOperations(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  // Keep the real route save and citation validation; only the external record adapter is synthetic.
  jest.mocked(operations.save).mockImplementation(input =>
    saveVisitQuestionRoute(input, async () => ({
      prepareUpcomingVisitQuestionContext: async () => context as never,
    })),
  );
  const route = await renderIntegratedRoute(operations);
  await startGeneration(route);
  await act(async () => {
    finish(generated);
  });
  await waitFor(() =>
    expect(route.getByTestId('next-visit-question-text-0')).toBeTruthy(),
  );
  await fireEvent.changeText(
    route.getByTestId('next-visit-question-text-0'),
    '저장할 질문',
  );
  await fireEvent.press(route.getByTestId('next-visit-review-save'));
  await waitFor(() => expect(route.getByText('저장할 질문')).toBeTruthy());
  expect(receive).toHaveBeenCalledWith(
    [
      expect.objectContaining({
        ...generated.questions[0],
        identity: { id: expect.any(String) },
        questionText: '저장할 질문',
      }),
      ...generated.questions.slice(1).map(question =>
        expect.objectContaining({
          ...question,
          identity: { id: expect.any(String) },
        }),
      ),
    ],
    [],
  );
  await fireEvent.press(route.getByTestId('next-visit-saved-edit'));
  await fireEvent.changeText(
    route.getByTestId('next-visit-question-text-0'),
    '버릴 질문',
  );
  await fireEvent.press(route.getByTestId('next-visit-review-cancel'));
  expect(route.getByText('저장할 질문')).toBeTruthy();
  expect(route.queryByText('버릴 질문')).toBeNull();
  expect(receive).toHaveBeenCalledTimes(1);
});
