import { act, render, screen, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { t } from '../../i18n';
import { OverviewHeartPanel } from './OverviewHeartPanel';
import { saveOverviewMetricSelection } from './metricSelection';
import { setup } from './testSupport/overviewWorkoutCardHarness';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => true,
}));
jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  isCurrentLocalAgentMemoryDatabase: jest.fn(),
}));
jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));

test('owns saved Heart selection independently of projection across switcher and background', async () => {
  const lane = await setup();
  const oldPhase = AppState.currentState;
  AppState.currentState = 'active';
  const panel = (state: 'ready' | 'loading' | 'failed') => (
    <OverviewHeartPanel width="100%" metrics={{}} state={state} />
  );
  try {
    const view = await render(panel('ready'));
    try {
      const result = () =>
        screen.getByTestId('overview-workout-heart-rate-result');
      const reads = lane.queryWorkoutPeriodHeartRate;
      await waitFor(() => expect(result()).toHaveTextContent('120 BPM'));
      expect(reads).toHaveBeenCalledTimes(1);
      for (const state of ['loading', 'failed'] as const) {
        await act(() => lane.transition('inactive'));
        await view.rerender(panel(state));
        await act(() => lane.transition('active'));
        await view.rerender(panel('ready'));
        expect(result()).toHaveTextContent('120 BPM');
        expect(reads).toHaveBeenCalledTimes(1);
      }
      await act(() => lane.transition('background'));
      expect(result()).not.toHaveTextContent('120 BPM');
      await view.rerender(panel('loading'));
      await act(() => lane.transition('active'));
      await waitFor(() => expect(result()).toHaveTextContent('120 BPM'));
      expect(reads).toHaveBeenCalledTimes(2);
      await view.rerender(panel('ready'));
      expect(reads).toHaveBeenCalledTimes(2);

      await act(async () => {
        lane.transition('background');
        await saveOverviewMetricSelection(lane.repository, ['sleep', 'steps']);
        lane.transition('active');
      });
      await waitFor(() =>
        expect(result()).toHaveTextContent(
          t('healthRecords.workoutHeartRate.periodUnavailable'),
        ),
      );
      expect(reads).toHaveBeenCalledTimes(2);
      expect(lane.requestReadAuthorizations).not.toHaveBeenCalled();
    } finally {
      await view.unmount();
    }
  } finally {
    AppState.currentState = oldPhase;
    lane.close();
  }
});
