import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { MultiAgentInvocation } from '@orot/agent-runtime';
import { DiseaseHypothesesScreen } from '../DiseaseHypothesesScreen';
import type { DiseaseHypothesisRunOutcome } from '../task';

const completed: DiseaseHypothesisRunOutcome = {
  status: 'workflow',
  result: {
    status: 'result',
    value: { hypotheses: [] },
    citations: [],
    coverage: [],
    checkpoint: {} as never,
  },
};

test('keeps safe response text separate from generic evidence activity', async () => {
  let finish!: (outcome: DiseaseHypothesisRunOutcome) => void;
  const onGenerate = jest.fn(
    (
      _signal?: AbortSignal,
      observer?: Pick<MultiAgentInvocation, 'onProgress' | 'onTaskStreamEvent'>,
    ) => {
      observer?.onProgress?.({
        type: 'evidence_search',
        status: 'started',
        sourceKind: 'reviewed_memory',
      });
      observer?.onTaskStreamEvent?.({ type: 'started' });
      observer?.onTaskStreamEvent?.({
        type: 'text_delta',
        text: '일부 기록에서 검토할 점이 있어요.',
      });
      return new Promise<DiseaseHypothesisRunOutcome>(resolve => {
        finish = resolve;
      });
    },
  );
  await render(
    <DiseaseHypothesesScreen
      onBack={jest.fn()}
      onGenerate={onGenerate}
      onOpenSource={jest.fn()}
    />,
  );

  await fireEvent.press(screen.getByTestId('disease-hypotheses-generate'));

  expect(onGenerate).toHaveBeenCalledWith(
    expect.any(AbortSignal),
    expect.objectContaining({
      onProgress: expect.any(Function),
      onTaskStreamEvent: expect.any(Function),
    }),
  );
  expect(
    await screen.findByTestId('disease-hypotheses-activity'),
  ).toHaveTextContent('필요한 자료를 찾고 있어요.');
  expect(
    await screen.findByText('일부 기록에서 검토할 점이 있어요.'),
  ).toBeTruthy();
  expect(screen.queryByText('personal_record')).toBeNull();
  finish(completed);
  await waitFor(() =>
    expect(screen.queryByTestId('disease-hypotheses-draft')).toBeNull(),
  );
});

test('cancel retains incomplete previews and ignores late progress, text, and results', async () => {
  let finish!: (outcome: DiseaseHypothesisRunOutcome) => void;
  let signal: AbortSignal | undefined;
  let observer:
    Pick<MultiAgentInvocation, 'onProgress' | 'onTaskStreamEvent'> | undefined;
  const onGenerate = jest.fn(
    (
      currentSignal?: AbortSignal,
      currentObserver?: Pick<
        MultiAgentInvocation,
        'onProgress' | 'onTaskStreamEvent'
      >,
    ) => {
      signal = currentSignal;
      observer = currentObserver;
      currentObserver?.onTaskStreamEvent?.({ type: 'started' });
      currentObserver?.onTaskStreamEvent?.({
        type: 'text_delta',
        text: '임시 초안이에요.',
      });
      return new Promise<DiseaseHypothesisRunOutcome>(resolve => {
        finish = resolve;
      });
    },
  );
  await render(
    <DiseaseHypothesesScreen
      onBack={jest.fn()}
      onGenerate={onGenerate}
      onOpenSource={jest.fn()}
    />,
  );

  await fireEvent.press(screen.getByTestId('disease-hypotheses-generate'));
  expect(await screen.findByTestId('disease-hypotheses-draft')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('disease-hypotheses-cancel'));
  expect(signal?.aborted).toBe(true);
  expect(
    await screen.findByTestId('disease-hypotheses-cancelled'),
  ).toBeTruthy();
  expect(screen.getByText('임시 초안이에요.')).toBeTruthy();
  expect(screen.getByText('완료되지 않은 응답 초안')).toBeTruthy();

  observer?.onProgress?.({
    type: 'model_started',
    phase: 'task_response',
  });
  observer?.onTaskStreamEvent?.({ type: 'text_delta', text: '늦은 응답' });
  finish(completed);
  await waitFor(() => {
    expect(screen.queryByTestId('disease-hypotheses-results')).toBeNull();
    expect(screen.queryByText('늦은 응답')).toBeNull();
  });
});

test('failure retains the displayed draft without promoting it to a result', async () => {
  await render(
    <DiseaseHypothesesScreen
      onBack={jest.fn()}
      onOpenSource={jest.fn()}
      onGenerate={async (_signal, observer) => {
        observer?.onTaskStreamEvent?.({
          type: 'text_delta',
          text: '표시된 일부 내용',
        });
        throw new Error('provider failed');
      }}
    />,
  );
  await fireEvent.press(screen.getByTestId('disease-hypotheses-generate'));
  expect(await screen.findByText('완료되지 않은 응답 초안')).toBeTruthy();
  expect(screen.getByText('표시된 일부 내용')).toBeTruthy();
  expect(screen.queryByTestId('disease-hypotheses-results')).toBeNull();
});
