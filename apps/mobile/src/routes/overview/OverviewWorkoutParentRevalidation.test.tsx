import { act, render, screen, waitFor } from '@testing-library/react-native';
import { useIsFocused } from '@react-navigation/native';
import { AppState } from 'react-native';
import { t } from '../../i18n';
import { notifyLocalSourceDeleted } from '../../storage/localDataClearEvents';
import { readIsolatedOverview } from '../../storage/secureDatabase';
import { OverviewMetrics } from './OverviewMetrics';
import { resultFor, setup } from './testSupport/overviewWorkoutCardHarness';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: jest.fn(() => true),
}));
jest.mock('../../storage/secureDatabase', () => ({
  readIsolatedOverview: jest.fn(),
  openLocalAgentMemoryDatabase: jest.fn(),
  isCurrentLocalAgentMemoryDatabase: jest.fn(),
}));
jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));

test.each(['available', 'parent failure', 'native denial'] as const)(
  'reads workout source changes independently while parent charts reload: %s',
  async outcome => {
    const lane = await setup();
    const previous = AppState.currentState;
    AppState.currentState = 'active';
    jest.mocked(useIsFocused).mockReturnValue(true);
    let release: (() => void) | undefined;
    let reads = 0;
    jest
      .mocked(readIsolatedOverview)
      .mockImplementation(async (_now, _signal, publish) => {
        if (++reads > 1) {
          await new Promise<void>(resolve => {
            release = resolve;
          });
          if (outcome === 'parent failure')
            throw new Error('Synthetic parent read failure');
        }
        publish({
          selection: ['heartRate'],
          chart: { metrics: {}, quantityTruncated: false },
        });
        return 'published';
      });
    try {
      const ui = await render(<OverviewMetrics />);
      try {
        const result = () =>
          screen.getByTestId('overview-workout-heart-rate-result');
        await waitFor(() => expect(result()).toHaveTextContent('120 BPM'));
        expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(1);
        if (outcome === 'native denial')
          lane.queryWorkoutPeriodHeartRate.mockImplementationOnce(
            async period => ({
              ...resultFor(period),
              status: 'unavailable',
            }),
          );
        await act(async () => notifyLocalSourceDeleted('local'));
        await waitFor(() => expect(release).toBeDefined());
        await waitFor(() =>
          expect(result()).toHaveTextContent(
            outcome !== 'native denial'
              ? '120 BPM'
              : t('healthRecords.workoutHeartRate.periodUnavailable'),
          ),
        );
        expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(2);
        await act(async () => release?.());
        expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(2);
        if (outcome === 'parent failure')
          expect(screen.getByRole('alert')).toHaveTextContent(
            t('overview.metricError'),
          );
        expect(lane.requestReadAuthorizations).not.toHaveBeenCalled();
      } finally {
        release?.();
        await ui.unmount();
      }
    } finally {
      AppState.currentState = previous;
      lane.close();
    }
  },
);
