import { act, renderHook } from '@testing-library/react-native';
import { useVisitQuestionSourceOpener } from '../useVisitQuestionSourceOpener';

test('a save keeps its validator when a later validator is installed', async () => {
  const { result } = await renderHook(() =>
    useVisitQuestionSourceOpener({
      onOpenSource: jest.fn(),
      registerVisitQuestionSource: jest.fn(),
      resolveSource: jest.fn(),
    } as never),
  );
  const original = jest.fn(async () => true);
  await act(() => result.current.rememberValidator(original));
  const saved = result.current.captureValidator();
  await act(() =>
    result.current.rememberValidator(async (reference, signal) =>
      Boolean(saved && (await saved(reference, signal))),
    ),
  );
  await expect(
    result.current.captureValidator()!(
      {} as never,
      new AbortController().signal,
    ),
  ).resolves.toBe(true);
  expect(original).toHaveBeenCalledTimes(1);
});
