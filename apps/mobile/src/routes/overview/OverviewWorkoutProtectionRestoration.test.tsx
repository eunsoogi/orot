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

test.each(['same scope', 'owner replaced', 'protection revoked'] as const)(
  'a writer invalidating the epoch during pre-native reproof: %s',
  async outcome => {
    const lane = await setup();
    const probe = lane.holdSecondProbe();
    try {
      const view = await render(
        <OverviewWorkoutHeartRateCard active width={302} />,
      );
      await probe.entered;
      expect(lane.queryWorkoutPeriodHeartRate).not.toHaveBeenCalled();
      await act(async () => {
        const writer = await lane.holdStartupWriter();
        await writer.release();
        if (outcome === 'owner replaced') lane.replaceOwner();
        if (outcome === 'protection revoked') lane.revoke();
        probe.release(outcome !== 'protection revoked');
      });
      if (outcome === 'same scope') {
        await waitFor(() =>
          expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(1),
        );
        await waitFor(() => expect(result()).toHaveTextContent('120 BPM'));
      } else {
        await waitFor(() =>
          expect(result()).toHaveTextContent(/심박수를 확인할 수 없어요/),
        );
        expect(lane.queryWorkoutPeriodHeartRate).not.toHaveBeenCalled();
      }
      expect(lane.requestReadAuthorizations).not.toHaveBeenCalled();
      await view.unmount();
    } finally {
      lane.close();
    }
  },
);

test.each(['same scope', 'owner replaced', 'protection revoked'] as const)(
  'a writer invalidating a settled card during foreground reconfirmation: %s',
  async outcome => {
    const lane = await setup();
    try {
      const view = await render(
        <OverviewWorkoutHeartRateCard active width={302} />,
      );
      await waitFor(() => expect(result()).toHaveTextContent('120 BPM'));
      const probe = lane.holdFirstProtectionProbe();
      await act(async () => {
        lane.transition('inactive');
        lane.transition('active');
      });
      await probe.entered;
      await act(async () => {
        const writer = await lane.holdStartupWriter();
        await writer.release();
        if (outcome === 'owner replaced') lane.replaceOwner();
        if (outcome === 'protection revoked') lane.revoke();
        probe.release(true);
      });
      if (outcome === 'same scope') {
        await waitFor(() =>
          expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(2),
        );
        await waitFor(() => expect(result()).toHaveTextContent('120 BPM'));
        const [first, second] = lane.queryWorkoutPeriodHeartRate.mock.calls;
        expect(second?.[0]).toMatchObject({
          fromInclusive: first?.[0].fromInclusive,
          toExclusive: first?.[0].toExclusive,
          workouts: first?.[0].workouts,
        });
      } else {
        await waitFor(() =>
          expect(result()).toHaveTextContent(/심박수를 확인할 수 없어요/),
        );
        expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(1);
      }
      expect(lane.requestReadAuthorizations).not.toHaveBeenCalled();
      await view.unmount();
    } finally {
      lane.close();
    }
  },
);
