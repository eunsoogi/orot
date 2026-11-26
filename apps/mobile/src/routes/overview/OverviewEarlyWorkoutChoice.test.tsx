import { AppState } from 'react-native';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { readIsolatedOverview } from '../../storage/secureDatabase';
import { OverviewMetrics } from './OverviewMetrics';
import { saveOverviewMetricSelection } from './metricSelection';
import { setup } from './testSupport/overviewWorkoutCardHarness';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => true,
}));
jest.mock('../../storage/secureDatabase', () => ({
  readIsolatedOverview: jest.fn(),
  openLocalAgentMemoryDatabase: jest.fn(),
  isCurrentLocalAgentMemoryDatabase: jest.fn(),
}));
jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));

const result = () => screen.getByTestId('overview-workout-heart-rate-result');

test.each(['available', 'removed', 'locked', 'default choice'] as const)(
  'cold exact preference owns workout independently of a held chart: %s',
  async outcome => {
    const lane = await setup();
    const oldPhase = AppState.currentState;
    AppState.currentState = 'active';
    const subscription = jest
      .spyOn(AppState, 'addEventListener')
      .mockReturnValue({ remove: jest.fn() });
    let releaseChart: (() => void) | undefined;
    let releaseProtection: ((value: boolean) => void) | undefined;
    const original = readIsolatedOverview.readWorkoutChoice;
    const obsoleteChartChoice = jest.fn();
    Object.assign(readIsolatedOverview, {
      readWorkoutChoice: obsoleteChartChoice,
    });
    try {
      if (outcome !== 'default choice')
        await saveOverviewMetricSelection(lane.repository, ['heartRate']);
      jest
        .mocked(readIsolatedOverview)
        .mockImplementation(async (_now, _signal, publish) => {
          await new Promise<void>(resolve => {
            releaseChart = resolve;
          });
          publish({
            selection:
              outcome === 'removed' ? ['sleep', 'steps'] : ['heartRate'],
            chart: { metrics: {}, quantityTruncated: false },
          });
          return 'published';
        });
      const valid = outcome === 'available' || outcome === 'default choice';
      const probe = valid ? undefined : lane.holdSecondProbe();
      releaseProtection = probe?.release;
      const view = await render(<OverviewMetrics />);
      try {
        await waitFor(() => expect(releaseChart).toBeDefined());
        if (probe) {
          await probe.entered;
          expect(lane.queryWorkoutPeriodHeartRate).not.toHaveBeenCalled();
          expect(result()).toHaveTextContent(/불러오는 중/);
          await act(async () => {
            if (outcome === 'locked') lane.revoke();
            else
              await saveOverviewMetricSelection(lane.repository, [
                'sleep',
                'steps',
              ]);
            probe.release(outcome !== 'locked');
          });
        }
        const terminal = valid ? '120 BPM' : /심박수를 확인할 수 없어요/;
        await waitFor(() => expect(result()).toHaveTextContent(terminal));
        expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(
          valid ? 1 : 0,
        );
        await act(async () => releaseChart?.());
        if (outcome === 'removed')
          expect(
            screen.queryByTestId('overview-workout-heart-rate-result'),
          ).toBeNull();
        else expect(result()).toHaveTextContent(terminal);
        expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(
          valid ? 1 : 0,
        );
        expect(obsoleteChartChoice).not.toHaveBeenCalled();
        expect(lane.requestReadAuthorizations).not.toHaveBeenCalled();
      } finally {
        await view.unmount();
      }
    } finally {
      releaseChart?.();
      releaseProtection?.(false);
      Object.assign(readIsolatedOverview, { readWorkoutChoice: original });
      subscription.mockRestore();
      AppState.currentState = oldPhase;
      lane.close();
    }
  },
);
