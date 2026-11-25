import { AppState } from 'react-native';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { readIsolatedOverview } from '../../storage/secureDatabase';
import { OverviewMetrics } from './OverviewMetrics';
import { selectedWorkoutChoiceProof } from './earlyWorkoutChoice';
import {
  loadOverviewMetricSelectionProof,
  saveOverviewMetricSelection,
} from './metricSelection';
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

test.each(['available', 'removed', 'locked', 'legacy'] as const)(
  'cold exact saved choice before a held chart projection: %s',
  async outcome => {
    const lane = await setup();
    const subscription = jest
      .spyOn(AppState, 'addEventListener')
      .mockReturnValue({ remove: jest.fn() });
    await saveOverviewMetricSelection(lane.repository, ['heartRate']);
    const receipt = selectedWorkoutChoiceProof(
      await loadOverviewMetricSelectionProof(lane.repository),
    );
    if (!receipt) throw new Error('Invalid fixture preference.');
    const hold = outcome === 'removed' || outcome === 'locked';
    const probe = hold ? lane.holdSecondProbe() : undefined;
    let emitChoice: (() => void) | undefined;
    let releaseChart: (() => void) | undefined;
    const original = readIsolatedOverview.readWorkoutChoice;
    const early: typeof readIsolatedOverview.readWorkoutChoice = async (
      _signal,
      publish,
    ) => {
      emitChoice = () => publish(receipt);
      return 'published';
    };
    Object.assign(readIsolatedOverview, {
      readWorkoutChoice: outcome === 'legacy' ? undefined : early,
    });
    jest
      .mocked(readIsolatedOverview)
      .mockImplementation(async (_now, _signal, publish) => {
        await new Promise<void>(resolve => {
          releaseChart = resolve;
        });
        publish({
          selection: outcome === 'removed' ? ['sleep', 'steps'] : ['heartRate'],
          chart: { metrics: {}, quantityTruncated: false },
          workoutChoiceWitness:
            outcome === 'removed' ? undefined : receipt.witness,
        });
        return 'published';
      });
    try {
      const view = await render(<OverviewMetrics />);
      await waitFor(() => expect(releaseChart).toBeDefined());
      expect(lane.queryWorkoutPeriodHeartRate).not.toHaveBeenCalled();
      if (outcome !== 'legacy') {
        await waitFor(() => expect(emitChoice).toBeDefined());
        await act(async () => emitChoice?.());
      }
      if (probe) {
        await probe.entered;
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
      if (outcome === 'available') {
        await waitFor(() => expect(result()).toHaveTextContent('120 BPM'));
        expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(1);
      } else {
        expect(lane.queryWorkoutPeriodHeartRate).not.toHaveBeenCalled();
        if (outcome === 'removed')
          expect(result()).toHaveTextContent(/불러오는 중/);
        if (outcome === 'locked')
          expect(result()).toHaveTextContent(/심박수를 확인할 수 없어요/);
      }
      await act(async () => releaseChart?.());
      if (outcome === 'legacy')
        await waitFor(() => expect(result()).toHaveTextContent('120 BPM'));
      if (outcome === 'removed')
        expect(
          screen.queryByTestId('overview-workout-heart-rate-result'),
        ).toBeNull();
      expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(
        outcome === 'available' || outcome === 'legacy' ? 1 : 0,
      );
      await view.unmount();
    } finally {
      Object.assign(readIsolatedOverview, { readWorkoutChoice: original });
      subscription.mockRestore();
      lane.close();
    }
  },
);
