import { fireEvent, render, screen } from '@testing-library/react-native';
import { AiFeatureRoute } from '../AiFeatureRoute';
import { createAiFeatureServices } from '../featureServices';
import type { AiFeatureServices } from '../featureServices';
import type { DiseaseHypothesisAnalysis } from '../../../diseaseHypotheses/types';

jest.mock('../featureServices');
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

test('opens a separate history destination and restores a selection on return without generation', async () => {
  const value: DiseaseHypothesisAnalysis = {
    presentation: 'symptom_summary',
    hypotheses: [
      {
        title: '저장된 활동 요약',
        summary: '저장된 활동 기록이에요.',
        uncertainty: '',
        missingData: [],
        supportingEvidence: [],
        contraryEvidence: [],
      },
    ],
    savedSummary: {
      status: 'saved',
      id: 'saved',
      createdAt: '2035-01-01T00:00:00Z',
      modelName: 'Synthetic',
    },
  };
  const history = {
    list: jest.fn(async () => [
      {
        id: 'saved',
        createdAt: '2035-01-01T00:00:00Z',
        modelName: 'Synthetic',
      },
    ]),
    read: jest.fn(async () => value),
  };
  const generate = jest.fn();
  jest.mocked(createAiFeatureServices).mockReturnValue({
    summaryHistory: history,
    generateDiseaseHypotheses: generate,
    summarizeSymptoms: generate,
  } as unknown as AiFeatureServices);
  await render(
    <AiFeatureRoute initialRoute="disease-hypotheses" onBack={jest.fn()} />,
  );
  await fireEvent.press(screen.getByTestId('symptom-summary-history-open'));
  expect(await screen.findByTestId('summary-history-screen')).toBeTruthy();
  expect(screen.queryByTestId('symptom-summary-generate')).toBeNull();
  await fireEvent.press(await screen.findByText(/Synthetic/));
  expect(await screen.findByText('저장된 활동 기록이에요.')).toBeTruthy();
  expect(screen.queryByTestId('summary-history-screen')).toBeNull();
  expect(history.read).toHaveBeenCalledWith('saved');
  expect(generate).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('symptom-summary-history-open'));
  expect(await screen.findByTestId('summary-history-screen')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('navigation-back'));
  expect(await screen.findByText('저장된 활동 기록이에요.')).toBeTruthy();
  expect(generate).not.toHaveBeenCalled();
});
