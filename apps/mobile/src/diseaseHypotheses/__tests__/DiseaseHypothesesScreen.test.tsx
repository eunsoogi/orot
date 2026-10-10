import { fireEvent, render, screen } from '@testing-library/react-native';
import { DiseaseHypothesesScreen } from '../DiseaseHypothesesScreen';
import type {
  DiseaseHypothesisAnalysis,
  DiseaseHypothesisRunOutcome,
} from '../task';

const reference = {
  sourceKind: 'personal_record' as const,
  sourceId: 'record-1',
  sourceRevision: '1',
  evidenceId: 'evidence-1',
  evidenceRevision: '1',
  locator: { kind: 'structured_record', recordId: 'record-1' },
  effectiveTime: null,
  reviewState: 'reviewed' as const,
};

const analysis: DiseaseHypothesisAnalysis = {
  hypotheses: [
    {
      title: '검토할 가능성',
      summary: '저장된 기록과 일부 맞는 부분이 있어요.',
      supportingEvidence: [reference],
      contraryEvidence: [],
      uncertainty: '자료가 제한적이에요.',
      missingData: ['진료 기록'],
    },
  ],
};

test('shows loading and opens the source citation for a result', async () => {
  let resolve!: (value: DiseaseHypothesisRunOutcome) => void;
  const onGenerate = jest.fn(
    () =>
      new Promise<DiseaseHypothesisRunOutcome>(done => {
        resolve = done;
      }),
  );
  const onOpenSource = jest.fn();
  await render(
    <DiseaseHypothesesScreen
      onBack={jest.fn()}
      onGenerate={onGenerate}
      onOpenSource={onOpenSource}
    />,
  );
  await fireEvent.press(screen.getByTestId('disease-hypotheses-generate'));
  expect(screen.getByTestId('disease-hypotheses-loading')).toBeTruthy();
  expect(
    screen.getByTestId('disease-hypotheses-generate').props.accessibilityState,
  ).toMatchObject({ busy: true, disabled: true });
  resolve({
    status: 'workflow',
    result: {
      status: 'result',
      value: analysis,
      citations: [reference],
      coverage: [],
      checkpoint: {} as never,
    },
  });
  expect(await screen.findByTestId('disease-hypotheses-results')).toBeTruthy();
  await fireEvent.press(screen.getByText(/원문 근거 열기/));
  expect(onOpenSource).toHaveBeenCalledWith(reference);
});

test('shows an insufficient-data state when the shared workflow finds gaps', async () => {
  const onGenerate = jest.fn(async () => ({
    status: 'workflow' as const,
    result: {
      status: 'needs_clarification' as const,
      reason: 'gaps',
      coverage: [],
      checkpoint: {} as never,
    },
  }));
  await render(
    <DiseaseHypothesesScreen
      onBack={jest.fn()}
      onGenerate={onGenerate}
      onOpenSource={jest.fn()}
    />,
  );
  await fireEvent.press(screen.getByTestId('disease-hypotheses-generate'));
  expect(
    await screen.findByTestId('disease-hypotheses-insufficient'),
  ).toBeTruthy();
  expect(screen.getByText(/더 많은 기록이나 근거/)).toBeTruthy();
});

test('states when no additional information was found', async () => {
  const outcome: DiseaseHypothesisRunOutcome = {
    status: 'workflow',
    result: {
      status: 'result',
      value: {
        hypotheses: [{ ...analysis.hypotheses[0], missingData: [] }],
      },
      citations: [reference],
      coverage: [],
      checkpoint: {} as never,
    },
  };
  await render(
    <DiseaseHypothesesScreen
      onBack={jest.fn()}
      onGenerate={async () => outcome}
      onOpenSource={jest.fn()}
    />,
  );

  await fireEvent.press(screen.getByTestId('disease-hypotheses-generate'));
  expect(await screen.findByText('확인된 추가 정보가 없어요.')).toBeTruthy();
});

test('shows a recoverable error when analysis cannot run', async () => {
  const onGenerate = jest.fn(async () => {
    throw new Error('provider unavailable');
  });
  await render(
    <DiseaseHypothesesScreen
      onBack={jest.fn()}
      onGenerate={onGenerate}
      onOpenSource={jest.fn()}
    />,
  );
  await fireEvent.press(screen.getByTestId('disease-hypotheses-generate'));
  expect(await screen.findByText(/가능성을 정리하지 못했어요/)).toBeTruthy();
});
