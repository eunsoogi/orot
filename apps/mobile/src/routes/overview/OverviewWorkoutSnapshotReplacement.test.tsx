import { act, render, screen, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { t } from '../../i18n';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import { OverviewWorkoutHeartRateCard } from './OverviewWorkoutHeartRateCard';
import { setup } from './testSupport/overviewWorkoutCardHarness';

jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  isCurrentLocalAgentMemoryDatabase: jest.fn(),
}));
jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));

test.each(['unchanged', 'changed', 'locked'] as const)(
  'replaces two cancelled predispatch epochs but never dispatches a changed or locked workout cohort: %s',
  async outcome => {
    const lane = await setup();
    const appState = AppState.currentState;
    AppState.currentState = 'active';
    const original = conversationExecutionNative();
    if (!original) throw new Error('Missing native fixture.');
    let probes = 0;
    const gates = new Map<number, (value: boolean) => void>();
    jest.mocked(conversationExecutionNative).mockReturnValue({
      ...original,
      protectedDataAvailable() {
        const probe = ++probes;
        // Initial confirmation, shared reproof, recovery confirmation; then
        // initial confirmation and shared reproof for the second owner.
        if (probe === 2 || probe === 5)
          return new Promise<boolean>(resolve => {
            gates.set(probe, resolve);
          });
        return original.protectedDataAvailable();
      },
    });
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
        await waitFor(() => expect(gates.has(2)).toBe(true));
        await act(async () => {
          await lane.repository.put('health_observation', lane.first);
          gates.get(2)?.(true);
        });
        await waitFor(() => expect(gates.has(5)).toBe(true));
        expect(result()).toHaveTextContent(t('healthRecords.loading'));
        expect(lane.queryWorkoutPeriodHeartRate).not.toHaveBeenCalled();
        await act(async () => {
          const changed = outcome === 'changed';
          const end = lane.second.endedAt;
          if (!end) throw new Error('Expected a timed workout fixture.');
          await lane.repository.put(
            'health_observation',
            changed
              ? {
                  ...lane.second,
                  endedAt: new Date(Date.parse(end) + 1000).toISOString(),
                }
              : lane.second,
          );
          if (outcome === 'locked') lane.revoke();
          gates.get(5)?.(true);
        });
        await waitFor(() =>
          expect(result()).toHaveTextContent(
            outcome === 'unchanged'
              ? '120 BPM'
              : t('healthRecords.workoutHeartRate.periodUnavailable'),
          ),
        );
        expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(
          outcome === 'unchanged' ? 1 : 0,
        );
        expect(lane.requestReadAuthorizations).not.toHaveBeenCalled();
      } finally {
        for (const finish of gates.values()) finish(false);
        await ui.unmount();
      }
    } finally {
      AppState.currentState = appState;
      lane.close();
    }
  },
);

test.each(['settles', 'locks'] as const)(
  'retains its initial owner when another guarded writer enters during foreground proof: %s',
  async outcome => {
    const lane = await setup();
    const appState = AppState.currentState;
    AppState.currentState = 'active';
    const original = conversationExecutionNative();
    if (!original) throw new Error('Missing native fixture.');
    const gates = new Map<number, (value: boolean) => void>();
    let probes = 0;
    jest.mocked(conversationExecutionNative).mockReturnValue({
      ...original,
      protectedDataAvailable() {
        const sequence = ++probes;
        if (sequence === 2 || sequence === 3) {
          return new Promise<boolean>(resolve => {
            gates.set(sequence, resolve);
          });
        }
        return original.protectedDataAvailable();
      },
    });
    let writer = await lane.holdStartupWriter();
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
        await act(async () => {
          await writer.release();
        });
        await waitFor(() => expect(gates.has(2)).toBe(true));
        await act(async () => {
          writer = await lane.holdStartupWriter();
          lane.transition('inactive');
          lane.transition('active');
          gates.get(2)?.(true);
        });
        expect(result()).toHaveTextContent(t('healthRecords.loading'));
        expect(lane.queryWorkoutPeriodHeartRate).not.toHaveBeenCalled();
        await act(async () => {
          await writer.release();
        });
        await waitFor(() => expect(gates.has(3)).toBe(true));
        await act(async () => {
          writer = await lane.holdStartupWriter();
          gates.get(3)?.(true);
          if (outcome === 'locks') lane.revoke();
        });
        expect(lane.queryWorkoutPeriodHeartRate).not.toHaveBeenCalled();
        if (outcome === 'settles')
          expect(result()).toHaveTextContent(t('healthRecords.loading'));
        await act(async () => {
          await writer.release();
        });
        await waitFor(() =>
          expect(result()).toHaveTextContent(
            outcome === 'settles'
              ? '120 BPM'
              : t('healthRecords.workoutHeartRate.periodUnavailable'),
          ),
        );
        expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(
          outcome === 'settles' ? 1 : 0,
        );
        expect(lane.requestReadAuthorizations).not.toHaveBeenCalled();
      } finally {
        for (const release of gates.values()) release(false);
        await ui.unmount();
      }
    } finally {
      await writer.release();
      AppState.currentState = appState;
      lane.close();
    }
  },
);
