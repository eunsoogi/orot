import { act, render, screen, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { t } from '../../i18n';
import { OverviewWorkoutHeartRateCard } from './OverviewWorkoutHeartRateCard';
import { resultFor, setup } from './testSupport/overviewWorkoutCardHarness';

jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  isCurrentLocalAgentMemoryDatabase: jest.fn(),
}));
jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));

test.each(['available', 'visible empty', 'denied'] as const)(
  'does not turn a cancelled foreground predecessor into a terminal result: %s',
  async outcome => {
    const lane = await setup();
    const before = AppState.currentState;
    AppState.currentState = 'active';
    const gate = lane.holdSecondProbe();
    const result = () =>
      screen.getByTestId('overview-workout-heart-rate-result');
    try {
      const card = (generation: number) => (
        <OverviewWorkoutHeartRateCard
          active
          selectionEpoch={generation}
          width={undefined}
        />
      );
      const view = await render(card(1));
      try {
        await gate.entered;
        await act(async () => {
          lane.transition('inactive');
          await lane.repository.put('health_observation', lane.first);
          lane.transition('active');
        });

        // The old owner has been revoked and the parent snapshot hasn't
        // published its new selection generation. There is no result yet.
        expect(result()).toHaveTextContent(/불러오는 중/);
        expect(lane.queryWorkoutPeriodHeartRate).not.toHaveBeenCalled();
        if (outcome === 'visible empty')
          lane.queryWorkoutPeriodHeartRate.mockImplementationOnce(
            async period => ({ ...resultFor(period), status: 'emptyVisible' }),
          );
        await act(async () => {
          if (outcome === 'denied') lane.revoke();
          gate.release(outcome !== 'denied');
        });
        await view.rerender(card(2));
        await waitFor(() =>
          expect(result()).toHaveTextContent(
            outcome === 'available'
              ? '120 BPM'
              : outcome === 'visible empty'
                ? t('healthRecords.workoutHeartRate.periodEmpty')
                : t('healthRecords.workoutHeartRate.periodUnavailable'),
          ),
        );
        expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(
          outcome === 'denied' ? 0 : 1,
        );
        expect(lane.requestReadAuthorizations).not.toHaveBeenCalled();
      } finally {
        gate.release(false);
        await view.unmount();
      }
    } finally {
      AppState.currentState = before;
      lane.close();
    }
  },
);
