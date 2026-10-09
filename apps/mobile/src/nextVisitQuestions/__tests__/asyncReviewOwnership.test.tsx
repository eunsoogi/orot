import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from '@testing-library/react-native';
import { useNextVisitQuestionsController } from '../controller';
import { NextVisitQuestionsScreen } from '../NextVisitQuestionsScreen';
import type { GenerationOutcome, NextVisitEvidenceReference } from '../types';
import {
  appointment,
  makeProps,
  questions,
  type Props,
} from '../testSupport/fixtures';

test('opening a saved review supersedes an in-flight generation', async () => {
  let requestSignal: AbortSignal | undefined;
  let resolveOutcome!: (
    outcome: GenerationOutcome<NextVisitEvidenceReference>,
  ) => void;
  const onGenerate: Props['onGenerate'] = jest.fn(
    (_visit, _selection, signal) => {
      requestSignal = signal;
      return new Promise(resolve => {
        resolveOutcome = resolve;
      });
    },
  );
  const { result } = await renderHook(() =>
    useNextVisitQuestionsController(makeProps({ onGenerate })),
  );

  let pendingGeneration!: Promise<void>;
  await act(async () => {
    pendingGeneration = result.current.generate();
    await Promise.resolve();
  });
  await act(async () => {
    result.current.startReview(questions);
  });
  const wasAborted = requestSignal?.aborted;
  await act(async () => {
    resolveOutcome({ status: 'ready', questions, caveats: [] });
    await pendingGeneration;
  });

  expect(wasAborted).toBe(true);
  expect(result.current.phase).toBe('reviewing');
  expect(result.current.draftQuestions).toEqual(questions);
});

test('a late save cannot replace a newer review after returning to the same visit', async () => {
  let resolveSave!: (
    result: Awaited<ReturnType<Props['onSaveReviewedQuestions']>>,
  ) => void;
  const onSaveReviewedQuestions: Props['onSaveReviewedQuestions'] = () =>
    new Promise(resolve => {
      resolveSave = resolve;
    });
  const initialProps = makeProps({ onSaveReviewedQuestions });
  const { result, rerender } = await renderHook(
    ({ props }: { props: Props }) => useNextVisitQuestionsController(props),
    { initialProps: { props: initialProps } },
  );

  await act(async () => result.current.startReview(questions));
  let pendingSave!: Promise<void>;
  await act(async () => {
    pendingSave = result.current.save();
    await Promise.resolve();
  });

  await act(async () => {
    rerender({
      props: {
        ...initialProps,
        appointment: {
          status: 'ready',
          appointment: { ...appointment, id: 'synthetic-appointment-2' },
        },
      },
    });
  });
  await act(async () => {
    rerender({ props: initialProps });
  });
  const replacement = [{ ...questions[0]!, questionText: '새로 연 검토 질문' }];
  await act(async () => result.current.startReview(replacement));

  await act(async () => {
    resolveSave({ questions, caveats: [], memoryStatus: 'saved' });
    await pendingSave;
  });

  expect(result.current.phase).toBe('reviewing');
  expect(result.current.draftQuestions).toEqual(replacement);
  expect(result.current.savedOverride).toBeNull();
});

test('keeps saved caveats during another generation and when reopening review', async () => {
  let callCount = 0;
  let resolveSecondGeneration!: (
    outcome: GenerationOutcome<NextVisitEvidenceReference>,
  ) => void;
  const onGenerate: Props['onGenerate'] = jest.fn(() => {
    callCount += 1;
    if (callCount === 1) {
      return Promise.resolve({
        status: 'ready',
        questions,
        caveats: ['conflicting_records'],
      });
    }
    return new Promise(resolve => {
      resolveSecondGeneration = resolve;
    });
  });
  await render(<NextVisitQuestionsScreen {...makeProps({ onGenerate })} />);
  const caveat =
    '기록에 서로 다른 내용이 있어 질문을 저장하기 전에 확인해 주세요.';

  await fireEvent.press(screen.getByTestId('next-visit-generate'));
  await screen.findByTestId('next-visit-review-list');
  expect(screen.getByText(caveat)).toBeTruthy();
  await fireEvent.press(screen.getByTestId('next-visit-review-save'));
  await screen.findByTestId('next-visit-saved-list');
  expect(screen.getByText(caveat)).toBeTruthy();

  const secondGenerationPress = fireEvent.press(
    screen.getByTestId('next-visit-generate'),
  );
  await screen.findByTestId('next-visit-generation-loading');
  await fireEvent.press(screen.getByTestId('next-visit-generation-cancel'));
  await act(async () => {
    resolveSecondGeneration({ status: 'ready', questions, caveats: [] });
    await secondGenerationPress;
  });

  expect(screen.getByText(caveat)).toBeTruthy();
  await fireEvent.press(screen.getByTestId('next-visit-saved-edit'));
  expect(screen.getByText(caveat)).toBeTruthy();
});
