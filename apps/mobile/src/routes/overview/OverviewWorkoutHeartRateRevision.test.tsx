import { act, render, screen, waitFor } from '@testing-library/react-native';
import { OverviewWorkoutHeartRateCard } from './OverviewWorkoutHeartRateCard';
import { resultFor, setup } from './testSupport/overviewWorkoutCardHarness';

jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  isCurrentLocalAgentMemoryDatabase: jest.fn(),
}));
jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));
const result = () => screen.getByTestId('overview-workout-heart-rate-result');

test.each([false, true])(
  'rechecks workout heart rate after a SQLite write only if the owner remains current (replaced: %s)',
  async replaced => {
    const lane = await setup();
    try {
      let release!: (value: ReturnType<typeof resultFor>) => void;
      lane.queryWorkoutPeriodHeartRate.mockReturnValueOnce(
        new Promise(resolve => {
          release = resolve;
        }),
      );
      const view = await render(
        <OverviewWorkoutHeartRateCard active width={302} />,
      );
      await waitFor(() =>
        expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(1),
      );
      const request = lane.queryWorkoutPeriodHeartRate.mock.calls[0]![0];
      await act(async () => {
        const writer = await lane.holdStartupWriter();
        await writer.release();
        if (replaced) lane.replaceOwner();
        release({ ...resultFor(request), mean: 145 });
      });
      await waitFor(() =>
        expect(result()).toHaveTextContent(
          replaced ? /확인할 수 없어요/ : '120 BPM',
        ),
      );
      expect(result()).not.toHaveTextContent('145 BPM');
      expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(
        replaced ? 1 : 2,
      );
      expect(lane.requestReadAuthorizations).not.toHaveBeenCalled();
      await view.unmount();
    } finally {
      lane.close();
    }
  },
);
