import { syncCommonObservationChanges } from '../../healthkit/commonObservations/sync';
import { healthKitSample } from '../../healthkit/commonObservations/testSupport';
import {
  healthKit,
  page,
} from '../../healthkit/commonObservations/testSyncSupport';
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

test('brief inactive transition retains the same proved period and coalesces duplicate foreground', async () => {
  const lane = await setup();
  try {
    const view = await render(
      <OverviewWorkoutHeartRateCard active width={302} />,
    );
    await waitFor(() => expect(result()).toHaveTextContent('120 BPM'));
    await act(async () => {
      lane.transition('inactive');
      lane.transition('active');
      lane.transition('active');
    });
    expect(result()).toHaveTextContent('120 BPM');
    expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(1);
    expect(lane.cancelWorkoutPeriodHeartRate).not.toHaveBeenCalled();
    await view.unmount();
  } finally {
    lane.close();
  }
});

test('a parked native reply stays unshown while inactive and publishes on active without a second query', async () => {
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
      lane.transition('inactive');
      release(resultFor(request));
    });
    expect(result()).toHaveTextContent(/불러오는 중/);
    expect(result()).not.toHaveTextContent('120');
    await act(async () => {
      lane.transition('active');
      lane.transition('active');
    });
    await waitFor(() => expect(result()).toHaveTextContent('120 BPM'));
    expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(1);
    expect(lane.cancelWorkoutPeriodHeartRate).not.toHaveBeenCalled();
    await view.unmount();
  } finally {
    lane.close();
  }
});

test('a failed native reply after a brief interruption retries once in foreground', async () => {
  const lane = await setup();
  try {
    let reject!: (reason: Error) => void;
    lane.queryWorkoutPeriodHeartRate.mockReturnValueOnce(
      new Promise((_, fail) => {
        reject = fail;
      }),
    );
    const view = await render(
      <OverviewWorkoutHeartRateCard active width={302} />,
    );
    await waitFor(() =>
      expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(1),
    );
    await act(async () => {
      lane.transition('inactive');
      reject(new Error('held native period read interrupted'));
    });
    expect(result()).toHaveTextContent(/불러오는 중/);
    expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(1);
    await act(async () => {
      lane.transition('active');
      lane.transition('active');
    });
    await waitFor(() => expect(result()).toHaveTextContent('120 BPM'));
    expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(2);
    expect(lane.requestReadAuthorizations).not.toHaveBeenCalled();
    await view.unmount();
  } finally {
    lane.close();
  }
});

test('a failed native reply with no interruption settles without a retry', async () => {
  const lane = await setup();
  try {
    lane.queryWorkoutPeriodHeartRate.mockRejectedValueOnce(
      new Error('unavailable in foreground'),
    );
    const view = await render(
      <OverviewWorkoutHeartRateCard active width={302} />,
    );
    await waitFor(() => expect(result()).toHaveTextContent(/확인할 수 없어요/));
    expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(1);
    await view.unmount();
  } finally {
    lane.close();
  }
});

test('true background clears a proven amount and resumes with one fresh query only', async () => {
  const lane = await setup();
  try {
    const view = await render(
      <OverviewWorkoutHeartRateCard active width={302} />,
    );
    await waitFor(() => expect(result()).toHaveTextContent('120 BPM'));
    await act(async () => lane.transition('background'));
    expect(result()).toHaveTextContent(/불러오는 중/);
    expect(result()).not.toHaveTextContent('120');
    expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(1);
    await act(async () => {
      lane.transition('active');
      lane.transition('active');
    });
    await waitFor(() => expect(result()).toHaveTextContent('120 BPM'));
    expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(2);
    await view.unmount();
  } finally {
    lane.close();
  }
});

test('only a committed workout import re-queries the focused empty period', async () => {
  const lane = await setup();
  try {
    lane.queryWorkoutPeriodHeartRate.mockImplementationOnce(async request => ({
      ...resultFor(request),
      status: 'emptyVisible',
    }));
    const view = await render(
      <OverviewWorkoutHeartRateCard active width={302} />,
    );
    await waitFor(() => expect(result()).toHaveTextContent(/기록이 없어요/));
    expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(1);
    const now = () => new Date().toISOString();
    const workout = healthKitSample('workouts', {
      id: '195dd035-5be5-4124-ad39-113445fb56c4',
      startDate: new Date(Date.now() - 120000).toISOString(),
      endDate: new Date(Date.now() - 60000).toISOString(),
    });
    await act(async () => {
      await syncCommonObservationChanges({
        feature: 'steps',
        repository: lane.repository,
        now,
        healthKit: healthKit([
          page({ addedSamples: [healthKitSample('steps')], cursor: 'step-1' }),
        ]),
      });
      await syncCommonObservationChanges({
        feature: 'workouts',
        repository: lane.repository,
        now,
        healthKit: healthKit([page({ cursor: 'workout-1' })]),
      });
    });
    expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(1);
    await act(async () => {
      await syncCommonObservationChanges({
        feature: 'workouts',
        repository: lane.repository,
        now,
        healthKit: healthKit([
          page({ addedSamples: [workout], cursor: 'workout-2' }),
        ]),
      });
    });
    await waitFor(() => expect(result()).toHaveTextContent('120 BPM'));
    await act(async () => {
      lane.transition('active');
      lane.transition('active');
    });
    expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(2);
    expect(lane.queryWorkoutPeriodHeartRate.mock.calls[1]![0].workouts).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: workout.id })]),
    );
    expect(lane.requestReadAuthorizations).not.toHaveBeenCalled();
    await view.unmount();
  } finally {
    lane.close();
  }
});

test.each([false, true])(
  'waits for a protected startup writer without issuing HealthKit work while unsettled (revoked: %s)',
  async revoke => {
    const lane = await setup();
    const writer = await lane.holdStartupWriter();
    try {
      const view = await render(
        <OverviewWorkoutHeartRateCard active width={302} />,
      );
      expect(result()).toHaveTextContent(/불러오는 중/);
      expect(lane.queryWorkoutPeriodHeartRate).not.toHaveBeenCalled();
      if (revoke) await act(() => lane.revoke());
      await act(() => writer.release());
      if (revoke) {
        expect(lane.queryWorkoutPeriodHeartRate).not.toHaveBeenCalled();
        expect(result()).not.toHaveTextContent('120');
      } else {
        await waitFor(() => expect(result()).toHaveTextContent('120 BPM'));
        expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(1);
      }
      expect(lane.requestReadAuthorizations).not.toHaveBeenCalled();
      await view.unmount();
    } finally {
      await writer.release();
      lane.close();
    }
  },
);

test('replaces a workout read retired by a same-owner SQLite write during the native reply', async () => {
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
      release({ ...resultFor(request), mean: 145 });
    });
    await waitFor(() => expect(result()).toHaveTextContent('120 BPM'));
    expect(result()).not.toHaveTextContent('145 BPM');
    expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(2);
    expect(lane.requestReadAuthorizations).not.toHaveBeenCalled();
    await view.unmount();
  } finally {
    lane.close();
  }
});
