import { act, render, screen, waitFor } from '@testing-library/react-native';
import { NativeModules } from 'react-native';
import { OverviewWorkoutHeartRateCard } from './OverviewWorkoutHeartRateCard';
import { resultFor, setup } from './testSupport/overviewWorkoutCardHarness';

jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  isCurrentLocalAgentMemoryDatabase: jest.fn(),
}));
jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));

test.each([
  'published',
  'bad-timestamps',
  'final-proof-denied',
  'cancelled',
  'opted-out',
] as const)(
  'exposes only fixed opt-in markers for the mounted %s path',
  async scenario => {
    const previous = NativeModules.OrotProviderDiagnostics;
    const report = jest.fn();
    NativeModules.OrotProviderDiagnostics = {
      enabled: scenario !== 'opted-out',
      report,
    };
    const lane = await setup();
    let release!: (value: ReturnType<typeof resultFor>) => void;
    lane.queryWorkoutPeriodHeartRate.mockReturnValueOnce(
      new Promise(resolve => {
        release = resolve;
      }),
    );
    const ui = await render(
      <OverviewWorkoutHeartRateCard active width={300} />,
    );
    try {
      await waitFor(() =>
        expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(1),
      );
      const request = lane.queryWorkoutPeriodHeartRate.mock.calls[0]![0];
      const result = resultFor(request);
      const payload =
        scenario === 'bad-timestamps'
          ? {
              ...result,
              firstSampleAtMs: Date.parse(request.fromInclusive) - 1,
            }
          : result;
      if (scenario === 'final-proof-denied') {
        const proof = lane.holdSecondProbe();
        await lane.consumeProbe();
        await act(async () => {
          release(payload);
          await proof.entered;
          proof.release(false);
        });
      } else if (scenario === 'cancelled') {
        await act(() => lane.transition('background'));
        await act(() => release(payload));
      } else {
        await act(() => release(payload));
      }
      const text = () =>
        screen.getByTestId('overview-workout-heart-rate-result');
      if (scenario === 'published' || scenario === 'opted-out')
        await waitFor(() => expect(text()).toHaveTextContent('120 BPM'));
      else if (scenario !== 'cancelled')
        await waitFor(() =>
          expect(text()).toHaveTextContent(/심박수를 확인할 수 없어요/),
        );
      else expect(text()).not.toHaveTextContent('120 BPM');

      const selected = report.mock.calls.filter(
        ([feature, stage]) =>
          feature === 'workout_period' &&
          [
            'shared_decode',
            'shared_finalproof',
            'overview_settlement',
          ].includes(stage),
      );
      const markers = (expected: readonly (readonly [string, string])[]) =>
        expected.map(([stage, outcome]) => ['workout_period', stage, outcome]);
      const available = [['shared_decode', 'available']] as const;
      const finalStarted = [['shared_finalproof', 'started']] as const;
      switch (scenario) {
        case 'published':
          expect(selected).toEqual(
            markers([
              ...available,
              ...finalStarted,
              ['shared_finalproof', 'completed'],
              ['overview_settlement', 'available'],
            ]),
          );
          break;
        case 'bad-timestamps':
          expect(selected).toEqual(
            markers([
              ['shared_decode', 'timestamps_invalid'],
              ...finalStarted,
              ['shared_finalproof', 'completed'],
              ['overview_settlement', 'unavailable'],
            ]),
          );
          break;
        case 'final-proof-denied':
          expect(selected).toEqual(
            markers([
              ...available,
              ...finalStarted,
              ['shared_finalproof', 'failed'],
              ['overview_settlement', 'unavailable'],
            ]),
          );
          break;
        case 'cancelled':
          expect(selected).toEqual(
            markers([
              ['overview_settlement', 'cancelled'],
              ['shared_decode', 'cancelled'],
              ['shared_finalproof', 'cancelled'],
            ]),
          );
          break;
        case 'opted-out':
          expect(report).not.toHaveBeenCalled();
          break;
      }
    } finally {
      await ui.unmount();
      NativeModules.OrotProviderDiagnostics = previous;
      lane.close();
    }
  },
);
