import { fireEvent, screen } from '@testing-library/react-native';

jest.mock('../../providers/selection/options', () => ({
  ...jest.requireActual('../../providers/selection/options'),
  loadAppleSelectionOption: jest.fn(async () => {
    const { createAppleSelectionOption } = jest.requireActual(
      '../../providers/selection/options',
    ) as typeof import('../../providers/selection/options');
    return createAppleSelectionOption('modelNotReady');
  }),
}));

/** This fixture exercises ordinary analysis without an eligible title model. */
export async function startStockSavedRecordingAnalysis() {
  const start = await screen.findByTestId('encounter-start');
  expect(screen.queryByTestId('recording-analysis-menu')).toBeNull();
  await fireEvent.press(start);
}
