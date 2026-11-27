import { act, render, screen, waitFor } from '@testing-library/react-native';
import { NativeModules } from 'react-native';
import { t } from '../../i18n';
import { isCurrentLocalAgentMemoryDatabase } from '../../storage/secureDatabase';
import { OverviewWorkoutHeartRateCard } from './OverviewWorkoutHeartRateCard';
import { setup } from './testSupport/overviewWorkoutCardHarness';

jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  isCurrentLocalAgentMemoryDatabase: jest.fn(),
}));
jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));

test.each(['same-owner', 'revoked', 'replaced'] as const)(
  're-proves a pre-cohort superseded epoch only on the same active owner: %s',
  async outcome => {
    const lane = await setup();
    const original = NativeModules.OrotProviderDiagnostics;
    const report = jest.fn();
    NativeModules.OrotProviderDiagnostics = { enabled: true, report };

    const databaseCurrent = jest.mocked(isCurrentLocalAgentMemoryDatabase);
    const witness = databaseCurrent.getMockImplementation();
    if (!witness) throw new Error('Missing synthetic database owner.');
    const execute = lane.statements.getMockImplementation();
    if (!execute) throw new Error('Missing SQLite executor.');
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    let writer: Promise<unknown> | undefined;
    // Pass the pre-acquisition owner check. The next check has a captured
    // epoch to supersede; a writer admitted before acquisition would only delay it.
    databaseCurrent
      .mockImplementationOnce(witness)
      .mockImplementationOnce(database => {
        // Admit a real guarded writer (which invalidates the independent epoch)
        // synchronously during the route's first owner check after acquiring it.
        lane.statements.mockImplementationOnce(async (...input) => {
          const result = await execute(...input);
          await gate;
          return result;
        });
        writer = database.execute(
          'UPDATE health_observations SET ingested_at = ingested_at',
        );
        return witness(database);
      });
    const ui = await render(
      <OverviewWorkoutHeartRateCard active width={300} />,
    );
    try {
      if (!writer) throw new Error('Missing superseding writer.');
      expect(report).toHaveBeenCalledWith(
        'workout_period',
        'overview_epoch',
        'cancelled',
      );
      expect(lane.queryWorkoutPeriodHeartRate).not.toHaveBeenCalled();
      if (outcome !== 'same-owner') {
        await act(() => {
          if (outcome === 'revoked') lane.revoke();
          else lane.replaceOwner();
        });
      }
      await act(async () => {
        release();
        await writer;
      });
      await waitFor(() =>
        expect(
          screen.getByTestId('overview-workout-heart-rate-result'),
        ).toHaveTextContent(
          outcome === 'same-owner'
            ? '120 BPM'
            : t('healthRecords.workoutHeartRate.periodUnavailable'),
        ),
      );
      expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(
        outcome === 'same-owner' ? 1 : 0,
      );
      if (outcome === 'same-owner')
        expect(report).not.toHaveBeenCalledWith(
          'workout_period',
          'overview_settlement',
          'unavailable',
        );
    } finally {
      release();
      await writer;
      await ui.unmount();
      NativeModules.OrotProviderDiagnostics = original;
      lane.close();
    }
  },
);
