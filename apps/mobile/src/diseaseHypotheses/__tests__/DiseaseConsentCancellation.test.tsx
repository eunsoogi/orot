import { fireEvent, render, screen } from '@testing-library/react-native';
import { DiseaseHypothesesScreen } from '../DiseaseHypothesesScreen';
import type { DiseaseHypothesisRunOutcome } from '../task';
import { getDiseaseHypothesisCopy } from '../copy';
import type { AiWorkflowObserver } from '../../agent/workflowActivity';

test.each(['summary', 'assessment'] as const)(
  'presents denied %s transfer as a consent stop and retries only that operation',
  async operation => {
    const outcome: DiseaseHypothesisRunOutcome = {
      status: 'workflow',
      result: {
        status: 'consent_required',
        reason: 'Synthetic declined transfer',
        checkpoint: {} as never,
      },
    };
    const generate = async (
      _signal?: AbortSignal,
      observer?: AiWorkflowObserver,
    ) => {
      observer?.onTaskStreamEvent?.({
        type: 'text_delta',
        text: '확인 중인 이전 초안',
      });
      return outcome;
    };
    const onGenerate = jest.fn(generate);
    const onSummarize = jest.fn(generate);
    await render(
      <DiseaseHypothesesScreen
        onBack={jest.fn()}
        onOpenSource={jest.fn()}
        onGenerate={onGenerate}
        onSummarize={onSummarize}
      />,
    );
    const action =
      operation === 'summary'
        ? 'symptom-summary-generate'
        : 'disease-hypotheses-generate';
    const selected = operation === 'summary' ? onSummarize : onGenerate;
    const other = operation === 'summary' ? onGenerate : onSummarize;
    await fireEvent.press(screen.getByTestId(action));
    expect(
      await screen.findByTestId('disease-hypotheses-consent-required'),
    ).toHaveTextContent(
      '외부 전송이 허용되지 않아 요청을 중단했어요. 다시 시도하면 전송 내용을 확인할 수 있어요.',
    );
    const copy = getDiseaseHypothesisCopy();
    expect(screen.queryByText(copy.summaryError)).toBeNull();
    expect(screen.queryByText(copy.error)).toBeNull();
    expect(screen.queryByTestId('disease-hypotheses-results')).toBeNull();
    expect(screen.getByText('확인 중인 이전 초안')).toBeTruthy();
    expect(screen.getByText(copy.incompleteHeading)).toBeTruthy();
    await fireEvent.press(screen.getByTestId(action));
    expect(selected).toHaveBeenCalledTimes(2);
    expect(other).not.toHaveBeenCalled();
  },
);
