import { act, renderHook } from '@testing-library/react-native';
import { savedHomeQuestions } from '../../../test-helpers/homeOverviewFixtures';
import { useHomePreparationData } from '../useHomePreparationData';

let mockFocused = true;
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => mockFocused,
}));
beforeEach(() => {
  mockFocused = true;
});

test('reads reviewed questions without generating content', async () => {
  const loadSavedVisitQuestions = jest.fn(async (id: string) =>
    savedHomeQuestions(id, ['약을 언제 먹나요?']),
  );
  const { result } = await renderHook(() =>
    useHomePreparationData('visit', { loadSavedVisitQuestions }),
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
    .mockResolvedValue(savedHomeQuestions('visit'));
  const { result } = await renderHook(() =>
    useHomePreparationData('visit', { loadSavedVisitQuestions }),
  );
  await act(async () => {});
  expect(result.current.questionState).toBe('failed');
  await act(async () => result.current.retry());
  expect(result.current.questionState).toBe('ready');
});

test('discards a late read for a previous appointment and rejects mismatched attribution', async () => {
  let finish!: (value: ReturnType<typeof savedHomeQuestions>) => void;
  const pending = new Promise<ReturnType<typeof savedHomeQuestions>>(
    resolve => {
      finish = resolve;
    },
  );
  const loadSavedVisitQuestions = jest
    .fn()
    .mockReturnValueOnce(pending)
    .mockResolvedValueOnce(savedHomeQuestions('other'));
  const { result, rerender } = await renderHook(
    ({ id }: { id: string }) =>
      useHomePreparationData(id, { loadSavedVisitQuestions }),
    { initialProps: { id: 'first' } },
  );
  await act(async () => {});
  await rerender({ id: 'second' });
  await act(async () => {
    finish(savedHomeQuestions('first', ['stale']));
  });
  expect(result.current.questions).toBeNull();
  expect(result.current.questionState).toBe('failed');
});
