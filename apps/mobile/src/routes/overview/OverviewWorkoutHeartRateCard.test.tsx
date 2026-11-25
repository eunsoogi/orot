import { act, render, screen, waitFor } from '@testing-library/react-native';
import { openLocalAgentMemoryDatabase } from '../../storage/secureDatabase';
import { notifyLocalSourceDeleted } from '../../storage/localDataClearEvents';
import { OverviewWorkoutHeartRateCard } from './OverviewWorkoutHeartRateCard';
import {
  setup,
  one,
  two,
  resultFor,
} from './testSupport/overviewWorkoutCardHarness';

jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  isCurrentLocalAgentMemoryDatabase: jest.fn(),
}));
jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));

const result = () => screen.getByTestId('overview-workout-heart-rate-result');

test('displays the direct period average only on the opted-in visible card and never opens a picker', async () => {
  const lane = await setup();
  try {
    const view = await render(
      <OverviewWorkoutHeartRateCard active={false} width={302} />,
    );
    expect(openLocalAgentMemoryDatabase).not.toHaveBeenCalled();
    await view.rerender(<OverviewWorkoutHeartRateCard active width={302} />);
    await waitFor(() => expect(result()).toHaveTextContent('120 BPM'));
    expect(screen.queryByRole('button', { name: '운동 선택하기' })).toBeNull();
    expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(1);
    const request = lane.queryWorkoutPeriodHeartRate.mock.calls[0]![0];
    expect(request.workouts.map(workout => workout.id)).toEqual([
      one.toLowerCase(),
      two.toLowerCase(),
    ]);
    const from = new Date(request.toExclusive);
    from.setHours(0, 0, 0, 0);
    from.setDate(from.getDate() - 6);
    expect(request.fromInclusive).toBe(from.toISOString());
    expect(lane.queryWorkoutHeartRate).not.toHaveBeenCalled();
    expect(lane.requestReadAuthorizations).not.toHaveBeenCalled();
    expect(lane.querySamples).not.toHaveBeenCalled();
    await act(() => lane.revoke());
    expect(result()).not.toHaveTextContent('120');
    await view.unmount();
  } finally {
    lane.close();
  }
});

test.each(['deleted', 'locked', 'blurred', 'changed'])(
  'does not show a native period read held during %s',
  async reason => {
    const lane = await setup();
    try {
      let release!: (value: ReturnType<typeof resultFor>) => void;
      lane.queryWorkoutPeriodHeartRate.mockReturnValueOnce(
        new Promise(resolve => {
          release = resolve;
        }),
      );
      const view = await render(
        <OverviewWorkoutHeartRateCard active width={undefined} />,
      );
      await waitFor(() =>
        expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(1),
      );
      const request = lane.queryWorkoutPeriodHeartRate.mock.calls[0]![0];
      if (reason === 'deleted') {
        await lane.repository.delete('health_observation', lane.first.id);
        await act(() =>
          notifyLocalSourceDeleted('healthkit', new Set([lane.first.id])),
        );
      } else if (reason === 'locked') await act(() => lane.revoke());
      else if (reason === 'blurred')
        await view.rerender(
          <OverviewWorkoutHeartRateCard active={false} width={undefined} />,
        );
      else {
        await lane.repository.put('health_observation', {
          ...lane.first,
          endedAt: new Date(
            Date.parse(lane.first.endedAt!) + 30000,
          ).toISOString(),
        });
      }
      if (reason !== 'changed')
        expect(lane.cancelWorkoutPeriodHeartRate).toHaveBeenCalledWith(
          request.callId,
        );
      await act(() => release(resultFor(request)));
      await waitFor(() =>
        expect(result()).toHaveTextContent(/심박수를 확인할 수 없어요/),
      );
      expect(result()).not.toHaveTextContent('120');
      await view.unmount();
    } finally {
      lane.close();
    }
  },
);

test('a repository replacement during final native confirmation does not release the result', async () => {
  const lane = await setup();
  try {
    let release!: (value: ReturnType<typeof resultFor>) => void;
    lane.queryWorkoutPeriodHeartRate.mockReturnValueOnce(
      new Promise(resolve => {
        release = resolve;
      }),
    );
    const view = await render(
      <OverviewWorkoutHeartRateCard active width={undefined} />,
    );
    await waitFor(() =>
      expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(1),
    );
    const request = lane.queryWorkoutPeriodHeartRate.mock.calls[0]![0];
    const gate = lane.holdSecondProbe();
    // The new hook uses exactly one final post-native confirmation. Arrange
    // an already-admitted first probe so that confirmation itself is held.
    await act(async () => {
      await lane.consumeProbe();
      release(resultFor(request));
      await gate.entered;
      lane.replaceOwner();
      gate.release(true);
    });
    expect(result()).not.toHaveTextContent('120');
    await view.unmount();
  } finally {
    lane.close();
  }
});

test('reimport during the last pre-native confirmation sends no cohort', async () => {
  const lane = await setup();
  try {
    const gate = lane.holdSecondProbe();
    const view = await render(
      <OverviewWorkoutHeartRateCard active width={undefined} />,
    );
    await gate.entered;
    await lane.repository.put('health_observation', {
      ...lane.first,
      endedAt: new Date(Date.parse(lane.first.endedAt!) + 30_000).toISOString(),
    });
    await act(() => gate.release(true));
    expect(lane.queryWorkoutPeriodHeartRate).not.toHaveBeenCalled();
    expect(result()).not.toHaveTextContent('120');
    await view.unmount();
  } finally {
    lane.close();
  }
});

test('refreshes a continuously visible card once at local midnight and clears its timer on blur', async () => {
  jest.useFakeTimers();
  const now = new Date(2026, 9, 31, 23, 59, 59, 500);
  jest.setSystemTime(now);
  const lane = await setup();
  try {
    const view = await render(
      <OverviewWorkoutHeartRateCard active width={undefined} />,
    );
    await waitFor(() => expect(result()).toHaveTextContent('120 BPM'));
    expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(1);
    const initial = lane.queryWorkoutPeriodHeartRate.mock.calls[0]![0];
    await act(() => jest.advanceTimersByTimeAsync(500));
    await waitFor(() =>
      expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(2),
    );
    const current = lane.queryWorkoutPeriodHeartRate.mock.calls[1]![0];
    expect(new Date(current.toExclusive).getDate()).toBe(1);
    expect(new Date(initial.fromInclusive).getDate()).toBe(25);
    expect(new Date(current.fromInclusive).getDate()).toBe(26);
    // In Los Angeles this subsequent local day is 25h, not a fixed 24h.
    const nextMidnight = new Date(2026, 10, 2);
    await act(() =>
      jest.advanceTimersByTimeAsync(nextMidnight.getTime() - Date.now() - 1),
    );
    expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(2);
    await act(() => jest.advanceTimersByTimeAsync(1));
    await waitFor(() =>
      expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(3),
    );
    await view.rerender(
      <OverviewWorkoutHeartRateCard active={false} width={undefined} />,
    );
    await act(() => jest.advanceTimersByTimeAsync(26 * 60 * 60 * 1000));
    expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(3);
    expect(result()).not.toHaveTextContent('120');
    await view.unmount();
  } finally {
    lane.close();
    jest.useRealTimers();
  }
});
