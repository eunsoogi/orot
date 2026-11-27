import { act, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, NativeModules } from 'react-native';
import { openOpSqliteFileQueue } from '../../../test-support/opSqliteFileQueueFixture';
import { OverviewHeartPanel } from './OverviewHeartPanel';
import { syncCommonObservationChanges } from '../../healthkit/commonObservations/sync';
import {
  healthKit,
  page,
} from '../../healthkit/commonObservations/testSyncSupport';
import { openLocalAgentMemoryDatabase } from '../../storage/secureDatabase';
import { bindProtectedLocalRepositories } from '../../storage/workoutStepAnchorContract';
import { resultFor, setup } from './testSupport/overviewWorkoutCardHarness';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => true,
}));
jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  isCurrentLocalAgentMemoryDatabase: jest.fn(),
}));
jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));
function gate() {
  let release!: () => void;
  const wait = new Promise<void>(resolve => {
    release = resolve;
  });
  return { wait, release };
}
test.each([
  'unrelated',
  'certified',
  'triggered',
  'pending',
  'delete-workout',
] as const)(
  'file-backed protected epoch at both boundaries (%s)',
  async cause => {
    const f = openOpSqliteFileQueue();
    const lane = await setup(f);
    const owner = await openLocalAgentMemoryDatabase();
    const repository =
      cause === 'certified' || cause === 'triggered' || cause === 'pending'
        ? bindProtectedLocalRepositories(lane.repository, owner, () => true)
        : lane.repository;
    if (cause === 'triggered')
      await owner.execute(`CREATE TEMP TRIGGER untrusted_checkpoint_side_effect AFTER INSERT ON main.healthkit_sync_checkpoints
        WHEN NEW.checkpoint_key = 'healthkit:steps:steps' BEGIN DELETE FROM health_observations; END`);
    const priorPhase = AppState.currentState;
    const priorDiag = NativeModules.OrotProviderDiagnostics;
    AppState.currentState = 'active';
    const heldProbe = lane.holdSecondProbe();
    const nativeGate = gate();
    const requested = gate();
    const cursorHeld = gate();
    let pending: Promise<void> | undefined;
    const record: string[] = [];
    const report = (feature: string, stage: string, outcome: string) => {
      if (feature === 'workout_period') record.push(stage + ':' + outcome);
    };
    NativeModules.OrotProviderDiagnostics = { enabled: true, report };
    let cursorSequence = 0;
    const putCursor = async () => {
      const result = await syncCommonObservationChanges({
        feature: 'steps',
        repository,
        healthKit: healthKit([
          page({ cursor: 'synthetic-anchor-' + ++cursorSequence }),
        ]),
        permissionPreviouslyRequested: true,
        now: () => new Date().toISOString(),
      });
      expect(result).toMatchObject({
        status: 'empty',
        cursorAdvanced: true,
        upserted: 0,
        deleted: 0,
      });
    };
    lane.queryWorkoutPeriodHeartRate.mockImplementationOnce(async args => {
      requested.release();
      await nativeGate.wait;
      return resultFor(args);
    });
    const view = await render(
      <OverviewHeartPanel width={304} metrics={{}} state="loading" />,
    );
    try {
      await heldProbe.entered;
      expect(lane.queryWorkoutPeriodHeartRate).not.toHaveBeenCalled();
      if (cause === 'unrelated' || cause === 'certified')
        await act(async () => {
          await putCursor();
        });
      await act(async () => heldProbe.release(true));
      await requested.wait;
      if (cause === 'unrelated')
        expect(record).toContain('shared_reproof:cancelled');
      expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(1);
      if (cause === 'pending') {
        const cursorEntered = gate();
        f.delayWorker(async query => {
          if (query.startsWith('INSERT INTO main.healthkit_sync_checkpoints')) {
            cursorEntered.release();
            await cursorHeld.wait;
          }
        });
        pending = putCursor();
        await cursorEntered.wait;
        await act(async () => nativeGate.release());
        await waitFor(() =>
          expect(record).toContain('shared_finalproof:completed'),
        );
        expect(screen.queryByText('120 BPM')).toBeNull();
        expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(1);
        await act(async () => {
          cursorHeld.release();
          await pending;
        });
        expect(await screen.findByText('120 BPM')).toBeVisible();
        expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(1);
        return;
      }
      await act(async () => {
        if (cause !== 'delete-workout') await putCursor();
        else await lane.repository.delete('health_observation', lane.first.id);
        nativeGate.release();
      });
      if (cause === 'certified') {
        expect(await screen.findByText('120 BPM')).toBeVisible();
        expect(
          record.filter(s => s === 'overview_protection:started'),
        ).toHaveLength(1);
        expect(record).not.toContain('shared_finalproof:cancelled');
        expect(record).not.toContain('shared_reproof:cancelled');
        expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(1);
        return;
      }
      await waitFor(() =>
        expect(record).toContain('shared_finalproof:cancelled'),
      );
      expect(record).toContain('shared_decode:available');
      if (cause === 'unrelated') {
        expect(await screen.findByText('120 BPM')).toBeVisible();
        expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(2);
        expect(
          record.filter(s => s === 'overview_protection:started'),
        ).toHaveLength(3);
        // Compare the exact original and successor bridge inputs, excluding the new call ID.
        const args = lane.queryWorkoutPeriodHeartRate.mock.calls.map(
          ([request]) => ({ ...request, callId: undefined }),
        );
        expect(args[0]).toEqual(args[1]);
      } else {
        await waitFor(() => expect(record).toContain('shared_cohort:failed'));
        expect(screen.queryByText('120 BPM')).toBeNull();
        expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(1);
      }
    } finally {
      nativeGate.release();
      heldProbe.release(false);
      await view.unmount();
      cursorHeld.release();
      await pending;
      await lane.close();
      AppState.currentState = priorPhase;
      NativeModules.OrotProviderDiagnostics = priorDiag;
    }
  },
);
