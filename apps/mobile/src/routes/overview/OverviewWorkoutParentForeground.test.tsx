import { useIsFocused } from '@react-navigation/native';
import { AppState, type AppStateStatus } from 'react-native';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { readIsolatedOverview } from '../../storage/secureDatabase';
import { OverviewMetrics } from './OverviewMetrics';
import { setup } from './testSupport/overviewWorkoutCardHarness';

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

const result = () => screen.getByTestId('overview-workout-heart-rate-result');

test.each([
  'available',
  'revoked',
  'background',
  'removed',
  'settings',
] as const)(
  'keeps native workout ownership independent from foreground metric reprojection: %s',
  async outcome => {
    const lane = await setup();
    jest.mocked(useIsFocused).mockReturnValue(true);
    const probe = lane.holdSecondProbe();
    let selectionRemoved = false;
    let appEvent: ((phase: AppStateStatus) => void) | undefined;
    const listener = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((event, change) => {
        if (event === 'change') appEvent = change;
        return { remove: jest.fn() };
      });
    let finishRefresh: (() => void) | undefined;
    jest
      .mocked(readIsolatedOverview)
      .mockImplementation(async (_now, _signal, publish) => {
        const emit = () =>
          publish({
            selection: selectionRemoved ? [] : ['heartRate'],
            chart: { metrics: {}, quantityTruncated: false },
          });
        if (
          !finishRefresh &&
          jest.mocked(readIsolatedOverview).mock.calls.length === 1
        ) {
          emit();
        } else {
          await new Promise<void>(done => {
            finishRefresh = () => {
              emit();
              done();
            };
          });
        }
        return 'published';
      });
    try {
      const view = await render(<OverviewMetrics />);
      await probe.entered;
      expect(lane.queryWorkoutPeriodHeartRate).not.toHaveBeenCalled();
      if (outcome === 'settings') {
        jest.mocked(useIsFocused).mockReturnValue(false);
        await view.rerender(<OverviewMetrics />);
        selectionRemoved = true;
        jest.mocked(useIsFocused).mockReturnValue(true);
        await view.rerender(<OverviewMetrics />);
      } else {
        await act(async () => {
          lane.transition(
            outcome === 'background' || outcome === 'removed'
              ? 'background'
              : 'inactive',
          );
          if (outcome === 'revoked') lane.revoke();
          if (outcome === 'removed') selectionRemoved = true;
          // Native foreground can precede the RN notification and reap stale authority.
          lane.transition('active');
        });
        expect(lane.queryWorkoutPeriodHeartRate).not.toHaveBeenCalled();
        await act(async () => appEvent?.('active'));
      }
      await waitFor(() => expect(finishRefresh).toBeDefined());
      if (outcome === 'available')
        expect(result()).toHaveTextContent(/불러오는 중/);
      await act(async () => probe.release(outcome !== 'revoked'));
      if (outcome === 'available') {
        await waitFor(() => expect(result()).toHaveTextContent('120 BPM'));
        expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(1);
      } else {
        if (outcome === 'revoked')
          expect(result()).toHaveTextContent(/심박수를 확인할 수 없어요/);
        expect(lane.queryWorkoutPeriodHeartRate).not.toHaveBeenCalled();
      }
      await act(async () => finishRefresh?.());
      if (outcome === 'background') {
        await waitFor(() => expect(result()).toHaveTextContent('120 BPM'));
      } else if (selectionRemoved) {
        expect(
          screen.queryByTestId('overview-workout-heart-rate-result'),
        ).toBeNull();
      }
      expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(
        outcome === 'available' || outcome === 'background' ? 1 : 0,
      );
      expect(lane.requestReadAuthorizations).not.toHaveBeenCalled();
      await view.unmount();
    } finally {
      listener.mockRestore();
      lane.close();
    }
  },
);

test.each(['available', 'denied'] as const)(
  'shows pending choice without opening native workout until cold projection: %s',
  async outcome => {
    const lane = await setup();
    jest.mocked(useIsFocused).mockReturnValue(true);
    let release: (() => void) | undefined;
    jest
      .mocked(readIsolatedOverview)
      .mockImplementation(async (_now, _signal, publish) => {
        await new Promise<void>(resolve => {
          release = resolve;
        });
        publish({
          selection: ['heartRate'],
          chart: { metrics: {}, quantityTruncated: false },
        });
        return 'published';
      });
    try {
      const view = await render(<OverviewMetrics />);
      await waitFor(() => expect(release).toBeDefined());
      expect(result()).toHaveTextContent(/불러오는 중/);
      expect(lane.queryWorkoutPeriodHeartRate).not.toHaveBeenCalled();
      await act(async () => {
        if (outcome === 'denied') lane.revoke();
        release?.();
      });
      await waitFor(() =>
        expect(result()).toHaveTextContent(
          outcome === 'available' ? '120 BPM' : /심박수를 확인할 수 없어요/,
        ),
      );
      expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(
        outcome === 'available' ? 1 : 0,
      );
      expect(lane.requestReadAuthorizations).not.toHaveBeenCalled();
      await view.unmount();
    } finally {
      lane.close();
    }
  },
);
