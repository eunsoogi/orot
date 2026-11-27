import { render, screen, waitFor } from '@testing-library/react-native';
import { OverviewWorkoutHeartRateCard } from './OverviewWorkoutHeartRateCard';
import { resultFor, setup } from './testSupport/overviewWorkoutCardHarness';

jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  isCurrentLocalAgentMemoryDatabase: jest.fn(),
}));
jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));

// Match the native accumulator's compensated additions and final division.
function nativeMean(bpm: number, count: number) {
  let sum = 0;
  let compensation = 0;
  for (let i = 0; i < count; i++) {
    const adjustment = bpm - compensation;
    const next = sum + adjustment;
    compensation = next - sum - adjustment;
    sum = next;
  }
  return sum / count;
}

test.each([
  { bound: 60.6, count: 9, direction: -1 },
  { bound: 83.2, count: 13, direction: 1 },
])(
  'a machine rounding overflow ($direction) still displays the exact bound',
  async ({ bound, count, direction }) => {
    const lane = await setup();
    const mean = nativeMean(bound, count);
    expect(Math.sign(mean - bound)).toBe(direction);
    try {
      lane.queryWorkoutPeriodHeartRate.mockImplementationOnce(
        async request => ({
          ...resultFor(request),
          sampleCount: count,
          minimum: bound,
          maximum: bound,
          mean,
        }),
      );
      const ui = await render(
        <OverviewWorkoutHeartRateCard active width={300} />,
      );
      try {
        await waitFor(() =>
          expect(
            screen.getByTestId('overview-workout-heart-rate-result'),
          ).toHaveTextContent(Math.trunc(bound) + ' BPM'),
        );
        expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(1);
      } finally {
        await ui.unmount();
      }
    } finally {
      lane.close();
    }
  },
);

test.each([
  { minimum: 83.2, maximum: 83.2, mean: 83.19 },
  { minimum: 83.2, maximum: 83.2, mean: 83.21 },
  { minimum: 83.20000000000002, maximum: 83.2, mean: 83.2 },
])(
  'a materially wrong mean or reversed range stays unavailable',
  async values => {
    const lane = await setup();
    try {
      lane.queryWorkoutPeriodHeartRate.mockImplementationOnce(
        async request => ({
          ...resultFor(request),
          ...values,
        }),
      );
      const ui = await render(
        <OverviewWorkoutHeartRateCard active width={300} />,
      );
      try {
        await waitFor(() => {
          expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(1);
          expect(
            screen.getByTestId('overview-workout-heart-rate-result'),
          ).toHaveTextContent(/심박수를 확인할 수 없어요/);
        });
      } finally {
        await ui.unmount();
      }
    } finally {
      lane.close();
    }
  },
);
