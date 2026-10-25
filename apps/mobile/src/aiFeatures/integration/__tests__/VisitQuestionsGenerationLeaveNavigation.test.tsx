import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { VisitQuestionRouteGeneration } from '../visitQuestionsRouteOperations';
import {
  appointment,
  readyQuestions,
  createOperations,
  renderIntegratedRoute,
  startGeneration,
} from '../testSupport/visitQuestionsRetentionFixtures';
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

// App lifetime is part of this regression; unrelated native startup work is not.
jest.mock('../../../backup/backupSupport', () => ({
  prepareBackupSupport: jest.fn(async () => 'ready'),
}));

jest.mock('../../../providers/selection/options', () => {
  const actual = jest.requireActual('../../../providers/selection/options');
  return {
    ...actual,
    loadAppleSelectionOption: jest.fn(async () =>
      actual.createAppleSelectionOption('available'),
    ),
  };
});

afterEach(() => jest.restoreAllMocks());

test('invalidates a retained review when the same appointment changes while away', async () => {
  let finish!: (outcome: VisitQuestionRouteGeneration) => void;
  const operations = createOperations(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  const route = await renderIntegratedRoute(operations);
  await startGeneration(route);
  await act(async () => {
    finish(readyQuestions());
  });
  await waitFor(() =>
    expect(route.getByTestId('next-visit-question-text-0')).toBeTruthy(),
  );
  await fireEvent.press(route.getByTestId('navigation-back'));
  jest.mocked(operations.loadAppointment).mockResolvedValue({
    ...appointment,
    calendarEventSnapshot: {
      ...appointment.calendarEventSnapshot,
      title: '변경된 합성 예약',
    },
  });
  await fireEvent.press(route.getByTestId('ai-feature-visit-questions'));
  await waitFor(() => expect(route.getByText('변경된 합성 예약')).toBeTruthy());
  expect(route.queryByTestId('next-visit-question-text-0')).toBeNull();
});

test('completes an explicit save while absent without saving twice on reentry', async () => {
  let finish!: (outcome: VisitQuestionRouteGeneration) => void;
  const operations = createOperations(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  let finishSave!: (value: Awaited<ReturnType<typeof operations.save>>) => void;
  jest.mocked(operations.save).mockImplementation(
    () =>
      new Promise(resolve => {
        finishSave = resolve;
      }),
  );
  const route = await renderIntegratedRoute(operations);
  await startGeneration(route);
  const generated = readyQuestions();
  await act(async () => {
    finish(generated);
  });
  await waitFor(() =>
    expect(route.getByTestId('next-visit-question-text-0')).toBeTruthy(),
  );
  await fireEvent.press(route.getByTestId('next-visit-review-save'));
  await waitFor(() => expect(operations.save).toHaveBeenCalledTimes(1));
  await fireEvent.press(route.getByTestId('navigation-back'));
  await act(async () => {
    finishSave({
      questions: generated.questions,
      caveats: generated.caveats ?? [],
      memoryStatus: 'saved',
      validateSource: async () => true,
    });
  });
  await fireEvent.press(route.getByTestId('ai-feature-visit-questions'));
  await waitFor(() =>
    expect(route.getByText('혈압 변화를 확인하는 합성 질문')).toBeTruthy(),
  );
  expect(route.queryByTestId('next-visit-question-text-0')).toBeNull();
  expect(operations.save).toHaveBeenCalledTimes(1);
});

test('keeps visit-question generation alive when leaving and returning', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  let signal: AbortSignal | undefined;
  let finish!: (outcome: VisitQuestionRouteGeneration) => void;
  const operations = createOperations(({ signal: requestSignal }) => {
    signal = requestSignal;
    return new Promise(resolve => {
      finish = resolve;
    });
  });
  const route = await renderIntegratedRoute(operations, true);
  await startGeneration(route);
  await waitFor(() => expect(operations.generate).toHaveBeenCalledTimes(1));

  await fireEvent.press(route.getByTestId('navigation-back'));
  await waitFor(() =>
    expect(route.queryByTestId('next-visit-questions-scroll')).toBeNull(),
  );
  expect(alert).not.toHaveBeenCalled();
  expect(signal?.aborted).toBe(false);

  // Finish with no visit screen mounted, then observe the same result on a new route.
  await act(async () => {
    finish(readyQuestions());
  });
  await fireEvent.press(route.getByTestId('ai-feature-visit-questions'));
  await waitFor(() =>
    expect(route.getByTestId('next-visit-question-text-0')).toHaveDisplayValue(
      '혈압 변화를 확인하는 합성 질문',
    ),
  );
  expect(operations.generate).toHaveBeenCalledTimes(1);
});

test('keeps an edited visit-question review draft through leave and reentry', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  let finish!: (outcome: VisitQuestionRouteGeneration) => void;
  const operations = createOperations(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  const route = await renderIntegratedRoute(operations);
  await startGeneration(route);
  await act(async () => {
    finish(readyQuestions());
  });
  await waitFor(() =>
    expect(route.getByTestId('next-visit-question-text-0')).toHaveDisplayValue(
      '혈압 변화를 확인하는 합성 질문',
    ),
  );
  await fireEvent.changeText(
    route.getByTestId('next-visit-question-text-0'),
    '수정 후 보존되어야 하는 합성 질문',
  );

  await fireEvent.press(route.getByTestId('navigation-back'));
  await waitFor(() =>
    expect(route.queryByTestId('next-visit-questions-scroll')).toBeNull(),
  );
  expect(alert).not.toHaveBeenCalled();
  await fireEvent.press(route.getByTestId('ai-feature-visit-questions'));

  await waitFor(() =>
    expect(route.getByTestId('next-visit-question-text-0')).toHaveDisplayValue(
      '수정 후 보존되어야 하는 합성 질문',
    ),
  );
});
