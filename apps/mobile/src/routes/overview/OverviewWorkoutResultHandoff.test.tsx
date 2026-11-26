import { act, render, screen, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { t } from '../../i18n';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
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
  'available',
  'visible empty',
  'protected loss',
  'background',
] as const)(
  'rechecks foreground if native briefly resigns after the result proof: %s',
  async outcome => {
    const lane = await setup();
    const appState = AppState.currentState;
    AppState.currentState = 'active';
    const original = conversationExecutionNative();
    if (!original) throw new Error('Missing native fixture.');
    let protectedAfterResult = false;
    let paused = false;
    const hasNativeResult = () =>
      lane.queryWorkoutPeriodHeartRate.mock.calls.length === 1;
    jest.mocked(conversationExecutionNative).mockReturnValue({
      ...original,
      async protectedDataAvailable() {
        const available = await original.protectedDataAvailable();
        protectedAfterResult ||= hasNativeResult() && available === true;
        return available;
      },
      currentPhase() {
        const phase = original.currentPhase?.() ?? 'unknown';
        if (phase === 'active' && protectedAfterResult && !paused) {
          paused = true;
          queueMicrotask(() => lane.transition('inactive'));
        }
        return phase;
      },
    });
    if (outcome === 'visible empty')
      lane.queryWorkoutPeriodHeartRate.mockImplementationOnce(async period => ({
        ...resultFor(period),
        status: 'emptyVisible',
      }));
    try {
      const ui = await render(
        <OverviewWorkoutHeartRateCard
          active
          selectionEpoch={1}
          width={undefined}
        />,
      );
      try {
        const result = () =>
          screen.getByTestId('overview-workout-heart-rate-result');
        await waitFor(() => expect(paused).toBe(true));
        expect(result()).toHaveTextContent(t('healthRecords.loading'));
        expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(1);
        await act(async () => {
          if (outcome === 'protected loss') lane.revoke();
          if (outcome === 'background') lane.transition('background');
          lane.transition('active');
        });
        await waitFor(() =>
          expect(result()).toHaveTextContent(
            outcome === 'available'
              ? '120 BPM'
              : outcome === 'visible empty'
                ? t('healthRecords.workoutHeartRate.periodEmpty')
                : outcome === 'protected loss'
                  ? t('healthRecords.workoutHeartRate.periodUnavailable')
                  : t('healthRecords.loading'),
          ),
        );
        expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(1);
        expect(lane.requestReadAuthorizations).not.toHaveBeenCalled();
      } finally {
        await ui.unmount();
      }
    } finally {
      AppState.currentState = appState;
      lane.close();
    }
  },
);
