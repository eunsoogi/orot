import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions, StyleSheet, View } from 'react-native';
import { DiseaseHypothesesScreen } from '../DiseaseHypothesesScreen';
import type {
  DiseaseHypothesisAnalysis,
  DiseaseHypothesisRunOutcome,
} from '../task';

/** Exercises the screen's real layout decision while its selected operation changes. */
const initialDimensions = {
  window: Dimensions.get('window'),
  screen: Dimensions.get('screen'),
};
const measuredWidths = new Map<
  string,
  { readonly x: number; readonly width: number }
>();
const measurableView = View as unknown as {
  prototype: {
    measureInWindow: (
      callback: (x: number, y: number, width: number, height: number) => void,
    ) => void;
  };
};

beforeEach(() => {
  measuredWidths.clear();
  jest
    .spyOn(measurableView.prototype, 'measureInWindow')
    .mockImplementation(function (
      this: { readonly props: { readonly testID?: string } },
      callback,
    ) {
      const bounds = measuredWidths.get(this.props.testID ?? '');
      if (bounds) callback(bounds.x, 0, bounds.width, 800);
    });
});

afterEach(() => {
  Dimensions.set(initialDimensions);
  jest.restoreAllMocks();
});

async function setWindowSize(width: number, fontScale: number) {
  const window = Dimensions.get('window');
  const screenDimensions = Dimensions.get('screen');
  await act(async () => {
    Dimensions.set({
      window: { ...window, width, fontScale },
      screen: { ...screenDimensions, width, fontScale },
    });
  });
}

function columnsAxis() {
  return StyleSheet.flatten(
    screen.getByTestId('disease-hypotheses-columns').props.style,
  )?.flexDirection;
}

const reference = {
  sourceKind: 'personal_record' as const,
  sourceId: 'record-1',
  sourceRevision: '1',
  evidenceId: 'evidence-1',
  evidenceRevision: '1',
  locator: { kind: 'structured_record' as const, recordId: 'record-1' },
  effectiveTime: null,
  reviewState: 'reviewed' as const,
};

const assessment: DiseaseHypothesisAnalysis = {
  hypotheses: [
    {
      title: '선택한 기록에서 검토할 가능성',
      summary: '가능성은 기록과 함께 검토해야 해요.',
      supportingEvidence: [reference],
      contraryEvidence: [],
      uncertainty: '확인된 자료가 제한적이에요.',
      missingData: ['증상이 시작된 시점'],
    },
  ],
};

test('keeps consent, separate actions, and selected evidence across measured reflow', async () => {
  const consent: DiseaseHypothesisRunOutcome = {
    status: 'workflow',
    result: {
      status: 'consent_required',
      reason: 'Synthetic declined transfer',
      checkpoint: {} as never,
    },
  };
  const result: DiseaseHypothesisRunOutcome = {
    status: 'workflow',
    result: {
      status: 'result',
      value: assessment,
      citations: [reference],
      coverage: [],
      checkpoint: {} as never,
    },
  };
  const onSummarize = jest.fn(async () => consent);
  const onGenerate = jest.fn(async () => result);
  const onOpenSource = jest.fn();
  measuredWidths.set('disease-hypotheses-columns-frame-host', {
    x: 0,
    width: 390,
  });
  await setWindowSize(390, 1);
  await render(
    <DiseaseHypothesesScreen
      onBack={jest.fn()}
      onOpenSource={onOpenSource}
      onSummarize={onSummarize}
      onGenerate={onGenerate}
    />,
  );

  expect(columnsAxis()).toBe('column');
  await fireEvent.press(screen.getByTestId('symptom-summary-generate'));
  expect(
    await screen.findByTestId('disease-hypotheses-consent-required'),
  ).toBeTruthy();
  expect(onSummarize).toHaveBeenCalledTimes(1);
  expect(onGenerate).not.toHaveBeenCalled();

  measuredWidths.set('disease-hypotheses-columns-frame-host', {
    x: 0,
    width: 1400,
  });
  await setWindowSize(1400, 1);
  expect(columnsAxis()).toBe('column');
  expect(
    screen.getByTestId('disease-hypotheses-consent-required'),
  ).toBeTruthy();
  expect(screen.getByTestId('symptom-summary-generate')).toBeTruthy();
  expect(screen.getByTestId('disease-hypotheses-generate')).toBeTruthy();

  measuredWidths.set('disease-hypotheses-columns-frame-host', {
    x: 0,
    width: 720,
  });
  await setWindowSize(720, 1.4);
  expect(columnsAxis()).toBe('column');
  expect(
    screen.getByTestId('disease-hypotheses-consent-required'),
  ).toBeTruthy();

  await fireEvent.press(screen.getByTestId('disease-hypotheses-generate'));
  expect(await screen.findByTestId('disease-hypotheses-results')).toBeTruthy();
  expect(screen.getByText('선택한 기록에서 검토할 가능성')).toBeTruthy();
  expect(onGenerate).toHaveBeenCalledTimes(1);
  expect(onSummarize).toHaveBeenCalledTimes(1);

  measuredWidths.set('disease-hypotheses-columns-frame-host', {
    x: 0,
    width: 1400,
  });
  await setWindowSize(1400, 1);
  expect(columnsAxis()).toBe('column');
  expect(screen.getByText('선택한 기록에서 검토할 가능성')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('원문 근거 열기 · 건강 기록'));
  expect(onOpenSource).toHaveBeenCalledWith(reference);
});
