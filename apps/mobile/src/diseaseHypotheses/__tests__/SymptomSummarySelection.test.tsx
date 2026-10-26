import { fireEvent, render, screen } from '@testing-library/react-native';
import { DiseaseHypothesesScreen } from '../DiseaseHypothesesScreen';
import type { DiseaseHypothesisRunOutcome } from '../task';
import { getDiseaseHypothesisCopy } from '../copy';
import { StyleSheet } from 'react-native';
import { appColors } from '../../layout/appColors';

test('presents both independently selectable operations with equal neutral emphasis', async () => {
  await render(
    <DiseaseHypothesesScreen
      onBack={jest.fn()}
      onOpenSource={jest.fn()}
      onGenerate={jest.fn()}
      onSummarize={jest.fn()}
    />,
  );
  const summary = StyleSheet.flatten(
    screen.getByTestId('symptom-summary-generate').props.style,
  );
  const assessment = StyleSheet.flatten(
    screen.getByTestId('disease-hypotheses-generate').props.style,
  );
  expect(summary).toEqual(assessment);
  expect(summary).toMatchObject({
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderWidth: 1,
    minHeight: 48,
    borderRadius: 14,
  });
  const copy = getDiseaseHypothesisCopy();
  for (const label of [copy.summaryGenerate, copy.generate]) {
    expect(
      StyleSheet.flatten(screen.getByText(label).props.style),
    ).toMatchObject({ color: appColors.text, fontSize: 16, fontWeight: '600' });
  }
});

test('runs only the explicitly chosen operation and preserves the disease assessment action', async () => {
  const refusal: DiseaseHypothesisRunOutcome = {
    status: 'workflow',
    result: {
      status: 'unavailable',
      reason: 'Synthetic refusal',
      providerErrorCode: 'safety_refusal',
      checkpoint: {} as never,
    },
  };
  const onGenerate = jest.fn(async () => refusal);
  const onSummarize = jest.fn(async () => refusal);
  await render(
    <DiseaseHypothesesScreen
      onBack={jest.fn()}
      onOpenSource={jest.fn()}
      onGenerate={onGenerate}
      onSummarize={onSummarize}
    />,
  );
  await fireEvent.press(screen.getByTestId('symptom-summary-generate'));
  expect(
    await screen.findByText(getDiseaseHypothesisCopy().safetyRefusal),
  ).toBeTruthy();
  expect(onSummarize).toHaveBeenCalledTimes(1);
  expect(onGenerate).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('disease-hypotheses-generate'));
  expect(onGenerate).toHaveBeenCalledTimes(1);
  expect(onSummarize).toHaveBeenCalledTimes(1);
});

test('keeps a failed summary retry on the summary action and does not relabel the assessment as its retry', async () => {
  const onGenerate = jest.fn();
  const onSummarize = jest.fn(
    async (): Promise<DiseaseHypothesisRunOutcome> => ({
      status: 'workflow',
      result: {
        status: 'invalid_output',
        reason: 'Synthetic invalid summary',
        checkpoint: {} as never,
      },
    }),
  );
  await render(
    <DiseaseHypothesesScreen
      onBack={jest.fn()}
      onOpenSource={jest.fn()}
      onGenerate={onGenerate}
      onSummarize={onSummarize}
    />,
  );
  await fireEvent.press(screen.getByTestId('symptom-summary-generate'));
  expect(await screen.findByText('요약 다시 시도하기')).toBeTruthy();
  expect(
    screen.getByText('기록을 요약하지 못했어요. 잠시 후 다시 시도해 주세요.'),
  ).toBeTruthy();
  expect(screen.getByText(getDiseaseHypothesisCopy().generate)).toBeTruthy();
  await fireEvent.press(screen.getByTestId('symptom-summary-generate'));
  expect(onSummarize).toHaveBeenCalledTimes(2);
  expect(onGenerate).not.toHaveBeenCalled();
});
