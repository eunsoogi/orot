import { act, renderHook } from '@testing-library/react-native';
import {
  activeHomeSymptom,
  homeJournal,
  savedHomeQuestions,
} from '../../../test-helpers/homeOverviewFixtures';
import { useHomePreparationData } from '../useHomePreparationData';

let mockFocused = true;
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => mockFocused,
}));
beforeEach(() => {
  mockFocused = true;
});

test('reads active symptoms and reviewed questions without writing or generating content', async () => {
  const repository = homeJournal([
    activeHomeSymptom,
    {
      ...activeHomeSymptom,
      id: 'resolved',
      status: 'resolved',
      resolvedAt: '2026-10-21T09:00:00Z',
    },
  ]);
  const loadSymptoms = jest.fn(async () => repository);
  const loadSavedVisitQuestions = jest.fn(async (id: string) =>
    savedHomeQuestions(id, ['약을 언제 먹나요?']),
  );
  const { result } = await renderHook(() =>
    useHomePreparationData('visit', { loadSymptoms, loadSavedVisitQuestions }),
  );
  await act(async () => {});
  expect(repository.list).toHaveBeenCalledWith({ status: 'active' });
  expect(result.current.symptoms).toEqual([activeHomeSymptom]);
  expect(result.current.questions?.questions[0]?.questionText).toBe(
    '약을 언제 먹나요?',
  );
  expect(repository.create).not.toHaveBeenCalled();
  expect(repository.update).not.toHaveBeenCalled();
  expect(repository.resolve).not.toHaveBeenCalled();
});

test('does not mistake a failed read for an empty first-user result and recovers on retry', async () => {
  const loadSymptoms = jest
    .fn()
    .mockRejectedValueOnce(new Error('locked'))
    .mockResolvedValue(homeJournal([]));
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
    useHomePreparationData('visit', { loadSymptoms, loadSavedVisitQuestions }),
  );
  await act(async () => {});
  expect(result.current.symptomState).toBe('failed');
  expect(result.current.questionState).toBe('failed');
  await act(async () => result.current.retry());
  expect(result.current.symptomState).toBe('ready');
  expect(result.current.questionState).toBe('ready');
});

test('discards a late read for a previous appointment and rejects mismatched attribution', async () => {
  let finish!: (value: ReturnType<typeof savedHomeQuestions>) => void;
  const pending = new Promise<ReturnType<typeof savedHomeQuestions>>(
    resolve => {
      finish = resolve;
    },
  );
  const loadSymptoms = async () => homeJournal([]);
  const loadSavedVisitQuestions = jest
    .fn()
    .mockReturnValueOnce(pending)
    .mockResolvedValueOnce(savedHomeQuestions('other'));
  const { result, rerender } = await renderHook(
    ({ id }: { id: string }) =>
      useHomePreparationData(id, { loadSymptoms, loadSavedVisitQuestions }),
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

test('refreshes a retained Home after returning from journal changes', async () => {
  const repository = homeJournal();
  const loadSymptoms = async () => repository;
  const { result, rerender } = await renderHook(() =>
    useHomePreparationData(undefined, { loadSymptoms }),
  );
  await act(async () => {});
  expect(result.current.symptoms).toHaveLength(1);
  mockFocused = false;
  await rerender({});
  (repository.list as jest.Mock).mockResolvedValue([]);
  mockFocused = true;
  await rerender({});
  await act(async () => {});
  expect(result.current.symptoms).toEqual([]);
  expect(result.current.symptomState).toBe('ready');
});
