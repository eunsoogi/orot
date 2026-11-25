import { act, render, screen, waitFor } from '@testing-library/react-native';
import { OverviewWorkoutHeartRateCard } from './OverviewWorkoutHeartRateCard';
import { setup } from './testSupport/overviewWorkoutCardHarness';

jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  isCurrentLocalAgentMemoryDatabase: jest.fn(),
}));
jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));
const result = () => screen.getByTestId('overview-workout-heart-rate-result');

test.each(['restored', 'unchanged', 'revoked'] as const)(
  'an older negative protection reply cannot discard a newer restoration: %s',
  async outcome => {
    const lane = await setup();
    const probe = lane.holdFirstProtectionProbe();
    try {
      const view = await render(
        <OverviewWorkoutHeartRateCard active width={302} />,
      );
      await probe.entered;
      expect(lane.queryWorkoutPeriodHeartRate).not.toHaveBeenCalled();
      await act(async () => {
        if (outcome !== 'unchanged') lane.restoreProtection();
        if (outcome === 'revoked') lane.revoke();
        probe.release(false);
      });
      if (outcome === 'restored') {
        await waitFor(() =>
          expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(1),
        );
        await waitFor(() =>
          expect(result()).not.toHaveTextContent(
            /불러오는 중|확인할 수 없어요/,
          ),
        );
        expect(probe.probes()).toBeGreaterThan(1);
      } else {
        expect(lane.queryWorkoutPeriodHeartRate).not.toHaveBeenCalled();
        expect(probe.probes()).toBe(1);
      }
      expect(lane.requestReadAuthorizations).not.toHaveBeenCalled();
      await view.unmount();
    } finally {
      lane.close();
    }
  },
);
