import { readOwnedWorkoutPeriod } from '../../healthkit/ownedWorkoutPeriodRead';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import {
  isCurrentLocalAgentMemoryDatabase,
  openLocalAgentMemoryDatabase,
} from '../../storage/secureDatabase';
import { acquireIndependentReadEpoch } from '../../storage/protectedReadEpoch';
import {
  one,
  resultFor,
  setup,
  two,
} from './testSupport/overviewWorkoutCardHarness';

jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  isCurrentLocalAgentMemoryDatabase: jest.fn(),
}));
jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));

async function fixture() {
  const lane = await setup();
  const database = await openLocalAgentMemoryDatabase();
  const epoch = acquireIndependentReadEpoch(database)!;
  const turn = new AbortController();
  const period = {
    fromInclusive: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    toExclusive: new Date().toISOString(),
  };
  return {
    ...lane,
    database,
    turn,
    read: () =>
      readOwnedWorkoutPeriod(period, {
        repository: lane.repository,
        signal: turn.signal,
        current: () =>
          epoch.current() && isCurrentLocalAgentMemoryDatabase(database),
        confirm: async () =>
          (await conversationExecutionNative()!.protectedDataAvailable()) ===
          true,
      }),
    close() {
      epoch.dispose();
      lane.close();
    },
  };
}

test('reproves the same synthetic protected workout period, rejecting identical stats with different membership', async () => {
  const lane = await fixture();
  try {
    const witness = await lane.read();
    expect(witness.result).toMatchObject({
      status: 'available',
      sampleCount: 5,
      mean: 120,
    });
    await expect(witness.reprove()).resolves.toBe(true);
    const request = lane.queryWorkoutPeriodHeartRate.mock.calls[0]![0];
    expect(request.workouts.map(workout => workout.id).sort()).toEqual(
      [one.toLowerCase(), two.toLowerCase()].sort(),
    );
    lane.queryWorkoutPeriodHeartRate.mockResolvedValueOnce({
      ...resultFor(request),
      membershipRevision: 'v1:' + 'a'.repeat(64),
    });
    await expect(witness.reprove()).resolves.toBe(false);
    lane.turn.abort();
    await expect(witness.reprove()).resolves.toBe(false);
    expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(3);
    expect(lane.requestReadAuthorizations).not.toHaveBeenCalled();
    expect(lane.querySamples).not.toHaveBeenCalled();
  } finally {
    lane.close();
  }
});

test('the local proof contains no raw identifiers and retired protection denies another native read', async () => {
  const lane = await fixture();
  try {
    const witness = await lane.read();
    expect(JSON.stringify(witness.result).toLowerCase()).not.toContain(
      one.toLowerCase(),
    );
    expect(JSON.stringify(witness.result).toLowerCase()).not.toContain(
      two.toLowerCase(),
    );
    lane.revoke();
    await expect(witness.reprove()).resolves.toBe(false);
    expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(1);
  } finally {
    lane.close();
  }
});

test('denies a same-valued reproof while a protected workout deletion is held', async () => {
  const lane = await fixture();
  let finishDeletion: (() => void) | undefined;
  let deletion: Promise<void> | undefined;
  try {
    const witness = await lane.read();
    let startNative!: () => void;
    let finishNative!: (result: ReturnType<typeof resultFor>) => void;
    const started = new Promise<void>(resolve => {
      startNative = resolve;
    });
    const held = new Promise<ReturnType<typeof resultFor>>(resolve => {
      finishNative = resolve;
    });
    lane.queryWorkoutPeriodHeartRate.mockImplementationOnce(() => {
      startNative();
      return held;
    });
    const reproof = witness.reprove();
    await started;
    let deleted!: () => void;
    const staged = new Promise<void>(resolve => {
      deleted = resolve;
    });
    const holdDeletion = new Promise<void>(resolve => {
      finishDeletion = resolve;
    });
    deletion = lane.database.transaction(async tx => {
      await tx.execute('DELETE FROM health_observations WHERE id = ?', [
        lane.first.id,
      ]);
      deleted();
      await holdDeletion;
    });
    await Promise.race([staged, deletion]);
    finishNative(resultFor(lane.queryWorkoutPeriodHeartRate.mock.calls[1]![0]));
    await expect(reproof).resolves.toBe(false);
    finishDeletion!();
    await deletion;
    await expect(witness.reprove()).resolves.toBe(false);
    expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(2);
  } finally {
    finishDeletion?.();
    await deletion;
    lane.close();
  }
});
