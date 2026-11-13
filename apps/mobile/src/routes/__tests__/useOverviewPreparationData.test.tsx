import { act, renderHook } from '@testing-library/react-native';
import { savedOverviewQuestions } from '../../../test-helpers/overviewFixtures';
import { useOverviewPreparationData } from '../useOverviewPreparationData';

let mockFocused = true;
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => mockFocused,
}));
beforeEach(() => {
  mockFocused = true;
});

test('reads reviewed questions without generating content', async () => {
  const loadSavedVisitQuestions = jest.fn(async (id: string) =>
    savedOverviewQuestions(id, ['약을 언제 먹나요?']),
  );
  const { result } = await renderHook(() =>
    useOverviewPreparationData('visit', { loadSavedVisitQuestions }),
  );
  await act(async () => {});
  expect(result.current.questions?.questions[0]?.questionText).toBe(
    '약을 언제 먹나요?',
  );
  expect(loadSavedVisitQuestions).toHaveBeenCalledWith('visit');
});

test('does not mistake a failed read for an empty first-user result and recovers on retry', async () => {
  const loadSavedVisitQuestions = jest
    .fn()
    .mockResolvedValueOnce({
      status: 'error',
      appointmentId: 'visit',
      questions: [],
      message: 'unavailable',
    })
    .mockResolvedValue(savedOverviewQuestions('visit'));
  const { result } = await renderHook(() =>
    useOverviewPreparationData('visit', { loadSavedVisitQuestions }),
  );
  await act(async () => {});
  expect(result.current.questionState).toBe('failed');
  await act(async () => result.current.retry());
  expect(result.current.questionState).toBe('ready');
});

test('discards a late read for a previous appointment and rejects mismatched attribution', async () => {
  let finish!: (value: ReturnType<typeof savedOverviewQuestions>) => void;
  const pending = new Promise<ReturnType<typeof savedOverviewQuestions>>(
    resolve => {
      finish = resolve;
    },
  );
  const loadSavedVisitQuestions = jest
    .fn()
    .mockReturnValueOnce(pending)
    .mockResolvedValueOnce(savedOverviewQuestions('other'));
  const { result, rerender } = await renderHook(
    ({ id }: { id: string }) =>
      useOverviewPreparationData(id, { loadSavedVisitQuestions }),
    { initialProps: { id: 'first' } },
  );
  await act(async () => {});
  await rerender({ id: 'second' });
  await act(async () => {
    finish(savedOverviewQuestions('first', ['stale']));
  });
  expect(result.current.questions).toBeNull();
  expect(result.current.questionState).toBe('failed');
});
