import { act, render, screen, waitFor } from '@testing-library/react-native';
import { NativeModules } from 'react-native';
import { isCurrentLocalAgentMemoryDatabase } from '../../storage/secureDatabase';
import { OverviewWorkoutHeartRateCard } from './OverviewWorkoutHeartRateCard';
import { resultFor, setup } from './testSupport/overviewWorkoutCardHarness';
import type { SqlDatabase } from '@orot/storage';

jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  isCurrentLocalAgentMemoryDatabase: jest.fn(),
}));
jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));

const value = () => screen.getByTestId('overview-workout-heart-rate-result');

test.each([
  'same',
  'revoked',
  'replaced',
  'cohort',
  'second-write',
  'inactive',
  'held',
  'held-revoked',
  'native-unavailable',
] as const)(
  'superseded post-native epoch waits for fresh native only on the same owner: %s',
  async mode => {
    const lane = await setup();
    const originalSink = NativeModules.OrotProviderDiagnostics;
    const databaseCurrent = jest.mocked(isCurrentLocalAgentMemoryDatabase);
    const witness = databaseCurrent.getMockImplementation();
    if (!witness) throw new Error('Missing synthetic database owner.');
    let owner: SqlDatabase | undefined;
    const pending: Promise<unknown>[] = [];
    const mutation = 'UPDATE health_observations SET ingested_at = ingested_at';
    databaseCurrent.mockImplementationOnce(database => {
      owner = database;
      if (mode !== 'held') pending.push(database.execute(mutation));
      return witness(database);
    });

    let release!: () => void;
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    const execute = lane.statements.getMockImplementation();
    if (!execute) throw new Error('Missing SQLite executor.');
    let decoded = 0;
    const report = jest.fn(
      (_feature: string, stage: string, outcome: string) => {
        if (
          stage !== 'shared_decode' ||
          outcome !==
            (mode === 'native-unavailable'
              ? 'native_unavailable'
              : 'available') ||
          !owner
        )
          return;
        decoded += 1;
        if (decoded === 1 && (mode === 'held' || mode === 'held-revoked')) {
          lane.statements.mockImplementationOnce(async (...args) => {
            const result = await execute(...args);
            await held;
            return result;
          });
        }
        if (decoded === 1 || (decoded === 2 && mode === 'second-write')) {
          pending.push(
            mode === 'cohort'
              ? owner.execute('DELETE FROM health_observations WHERE id = ?', [
                  lane.first.id,
                ])
              : owner.execute(mutation),
          );
        }
        if (decoded !== 1) return;
        if (mode === 'revoked') lane.revoke();
        if (mode === 'replaced') lane.replaceOwner();
        if (mode === 'inactive') lane.transition('inactive');
      },
    );
    NativeModules.OrotProviderDiagnostics = { enabled: true, report };
    lane.queryWorkoutPeriodHeartRate.mockImplementationOnce(async request => ({
      ...resultFor(request),
      mean: 145,
      ...(mode === 'native-unavailable' ? { status: 'unavailable' } : {}),
    }));
    const ui = await render(
      <OverviewWorkoutHeartRateCard active width={302} />,
    );
    try {
      if (mode !== 'held')
        expect(report).toHaveBeenCalledWith(
          'workout_period',
          'overview_epoch',
          'cancelled',
        );
      expect(report).toHaveBeenCalledWith(
        'workout_period',
        'shared_finalproof',
        'cancelled',
      );
      const finalProofs = report.mock.calls.filter(
        ([, stage]) => stage === 'shared_finalproof',
      );
      expect(finalProofs[0]).toEqual([
        'workout_period',
        'shared_finalproof',
        'cancelled',
      ]);
      if (mode === 'held') {
        await act(async () => {
          await new Promise<void>(resolve => setTimeout(resolve, 2_600));
        });
        expect(value()).toHaveTextContent(/불러오는 중/);
        expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(1);
      }
      if (mode === 'held-revoked') {
        expect(value()).toHaveTextContent(/불러오는 중/);
        await act(async () => lane.revoke());
      }
      await act(async () => {
        release();
        await Promise.all(pending);
      });
      if (mode === 'inactive') {
        expect(value()).toHaveTextContent(/불러오는 중/);
        expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(1);
        await act(async () => lane.transition('active'));
      }
      await waitFor(() =>
        expect(value()).toHaveTextContent(
          mode === 'same' ||
            mode === 'second-write' ||
            mode === 'held' ||
            mode === 'inactive'
            ? '120 BPM'
            : /확인할 수 없어요/,
        ),
      );
      expect(value()).not.toHaveTextContent('145 BPM');
      const queries = lane.queryWorkoutPeriodHeartRate.mock.calls.map(
        call => call[0],
      );
      expect(queries).toHaveLength(
        mode === 'second-write'
          ? 3
          : mode === 'same' || mode === 'held' || mode === 'inactive'
            ? 2
            : 1,
      );
      if (queries[1])
        expect(queries[1]).toEqual({
          ...queries[0],
          callId: queries[1].callId,
        });
      expect(lane.requestReadAuthorizations).not.toHaveBeenCalled();
    } finally {
      release();
      await Promise.all(pending);
      await ui.unmount();
      NativeModules.OrotProviderDiagnostics = originalSink;
      lane.close();
    }
  },
);
