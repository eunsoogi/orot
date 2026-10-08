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

// Cold React Native test workers can need longer than Jest's five-second default.
jest.setTimeout(15000);

test('shows appointment and provider loading states and keeps generation unavailable', async () => {
  const props = makeProps({
    appointment: { status: 'loading' },
    provider: { status: 'unselected', selection: null },
  });
  await render(<NextVisitQuestionsScreen {...props} />);

  expect(screen.getByText('다음 예약을 확인하고 있어요.')).toBeTruthy();
  expect(screen.getByText('AI를 선택해 주세요.')).toBeTruthy();
  expect(screen.getByTestId('next-visit-generate')).toBeDisabled();
  await fireEvent.press(screen.getByTestId('next-visit-provider-select'));
  expect(props.onOpenProviderSelection).toHaveBeenCalledTimes(1);
});

test('lets the person retry a failed appointment lookup', async () => {
  const props = makeProps({
    appointment: { status: 'error', message: '합성 예약 조회 오류' },
  });
  await render(<NextVisitQuestionsScreen {...props} />);

  expect(screen.getByText('합성 예약 조회 오류')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('next-visit-appointment-retry'));
  expect(props.onRefreshAppointment).toHaveBeenCalledTimes(1);
});

test('aborts an in-flight generation and ignores its late result', async () => {
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
  const inputs = makeProps({ onGenerate });
  const { result } = await renderHook(() =>
    useNextVisitQuestionsController(inputs),
  );

  let pendingGeneration!: Promise<void>;
  await act(async () => {
    pendingGeneration = result.current.generate();
    await Promise.resolve();
  });
  expect(result.current.phase).toBe('generating');
  await act(async () => {
    result.current.cancelGeneration();
  });
  expect(requestSignal?.aborted).toBe(true);
  await act(async () => {
    resolveOutcome({ status: 'ready', questions, caveats: [] });
    await pendingGeneration;
  });

  expect(result.current.phase).toBe('idle');
  expect(result.current.generationMessage).toBe('질문 생성을 취소했어요.');
  expect(result.current.draftQuestions).toEqual([]);
});

test('aborts in-flight generation when the selected provider changes', async () => {
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
  const initialProps = makeProps({ onGenerate });
  const { result, rerender } = await renderHook(
    ({ props }: { props: Props }) => useNextVisitQuestionsController(props),
    { initialProps: { props: initialProps } },
  );

  let pendingGeneration!: Promise<void>;
  await act(async () => {
    pendingGeneration = result.current.generate();
    await Promise.resolve();
  });

  await act(async () => {
    rerender({
      props: {
        ...initialProps,
        provider: {
          status: 'available',
          selection: {
            providerId: 'synthetic-provider-2',
            modelId: 'fixture-model',
          },
          displayName: '다른 합성 제공자',
          privacyBoundary: 'on-device',
        },
      },
    });
  });

  const wasAborted = requestSignal?.aborted;
  await act(async () => {
    // The fixture deliberately resolves despite abort to prove late results are ignored.
    resolveOutcome({ status: 'ready', questions, caveats: [] });
    await pendingGeneration;
  });

  expect(wasAborted).toBe(true);
  expect(result.current.phase).toBe('idle');
  expect(result.current.generationMessage).toBe(
    '선택한 AI가 바뀌어 질문 생성을 멈췄어요. 새 선택으로 다시 시도해 주세요.',
  );
  expect(result.current.draftQuestions).toEqual([]);
});

test('does not apply a completed save to a different appointment', async () => {
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

  await act(async () => {
    result.current.startReview(questions);
  });
  let pendingSave!: Promise<void>;
  await act(async () => {
    pendingSave = result.current.save();
    await Promise.resolve();
  });
  expect(result.current.phase).toBe('saving');

  const nextAppointment = {
    ...appointment,
    id: 'synthetic-appointment-2',
  };
  await act(async () => {
    rerender({
      props: {
        ...initialProps,
        appointment: { status: 'ready', appointment: nextAppointment },
        savedQuestions: { status: 'ready', questions: [], caveats: [] },
      },
    });
  });

  await act(async () => {
    // Persistence may finish after navigation; its response belongs to the old visit.
    resolveSave({ questions, caveats: [], memoryStatus: 'saved' });
    await pendingSave;
  });

  expect(result.current.phase).toBe('idle');
  expect(result.current.savedOverride).toBeNull();
  expect(result.current.draftQuestions).toEqual([]);
});

test('surfaces a stale-evidence result and its caveat without creating candidates', async () => {
  const onGenerate: Props['onGenerate'] = async () => ({
    status: 'refresh_required',
    message: '합성 자료 갱신이 필요합니다.',
    caveats: ['incomplete_coverage'],
  });
  await render(<NextVisitQuestionsScreen {...makeProps({ onGenerate })} />);

  await fireEvent.press(screen.getByTestId('next-visit-generate'));
  expect(await screen.findByText('합성 자료 갱신이 필요합니다.')).toBeTruthy();
  expect(
    screen.getByText('일부 자료를 확인하지 못해 놓친 정보가 있을 수 있어요.'),
  ).toBeTruthy();
  expect(screen.queryByTestId('next-visit-review-list')).toBeNull();
});

test('shows insufficient evidence without creating a question review list', async () => {
  const onGenerate: Props['onGenerate'] = async () => ({
    status: 'needs_clarification',
    message: '합성 근거가 부족합니다.',
    caveats: ['insufficient_evidence'],
  });
  await render(<NextVisitQuestionsScreen {...makeProps({ onGenerate })} />);

  await fireEvent.press(screen.getByTestId('next-visit-generate'));
  expect(await screen.findByText('합성 근거가 부족합니다.')).toBeTruthy();
  expect(
    screen.getByText('현재 확인된 근거가 부족해 질문을 만들지 않았어요.'),
  ).toBeTruthy();
  expect(screen.queryByTestId('next-visit-review-list')).toBeNull();
});

test('rejects a generated result that does not contain three to five candidates', async () => {
  const onGenerate: Props['onGenerate'] = async () => ({
    status: 'ready',
    questions: questions.slice(0, 2),
    caveats: [],
  });
  await render(<NextVisitQuestionsScreen {...makeProps({ onGenerate })} />);

  await fireEvent.press(screen.getByTestId('next-visit-generate'));
  expect(
    await screen.findByText(
      '질문 후보를 확인할 수 없어 표시하지 않았어요. 다시 시도해 주세요.',
    ),
  ).toBeTruthy();
  expect(screen.queryByTestId('next-visit-review-list')).toBeNull();
});
