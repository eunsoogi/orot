import {
  readLocalConversationWorkoutPeriod,
  readOwnedWorkoutPeriod,
} from '../../healthkit/ownedWorkoutPeriodRead';
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
    read: (read = readOwnedWorkoutPeriod, repository = lane.repository) =>
      read(period, {
        repository,
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

test('strict local Conversation proof rejects a display-only native reply without complete-period coverage', async () => {
  const lane = await fixture();
  try {
    const witness = await lane.read(readLocalConversationWorkoutPeriod);
    expect(witness.result).toEqual({ status: 'unavailable' });
    expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledWith(
      expect.objectContaining({
        workoutCohortPolicy: 'exact-visible-native-cohort',
        workouts: expect.arrayContaining([
          expect.objectContaining({ id: one.toLowerCase() }),
          expect.objectContaining({ id: two.toLowerCase() }),
        ]),
      }),
    );
    await expect(witness.reprove()).resolves.toBe(false);
    expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(1);
  } finally {
    lane.close();
  }
});

test('strict local Workout witness reproves fresh complete coverage, never substituting an ordinary or partial result', async () => {
  const lane = await fixture();
  try {
    lane.queryWorkoutPeriodHeartRate.mockImplementationOnce(async request => ({
      ...resultFor(request),
      workoutCohortPolicy: 'exact-visible-native-cohort',
    }));
    const witness = await lane.read(readLocalConversationWorkoutPeriod);
    expect(witness.result).toMatchObject({ status: 'available', mean: 120 });
    lane.queryWorkoutPeriodHeartRate.mockImplementationOnce(async request => ({
      ...resultFor(request),
      workoutCohortPolicy: 'exact-visible-native-cohort',
    }));
    await expect(witness.reprove()).resolves.toBe(true);
    // A new visible Workout missing from import invalidates native completeness,
    // even if a display-only read happens to return the same numbers.
    await expect(witness.reprove()).resolves.toBe(false);
    expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(3);
    expect(lane.requestReadAuthorizations).not.toHaveBeenCalled();
  } finally {
    lane.close();
  }
});

test.each(['during-native', 'before-reproof'] as const)(
  'strict local proof rejects SQL membership replacement: %s',
  async mode => {
    const lane = await fixture();
    try {
      let changed = false;
      const repository = {
        ...lane.repository,
        listHealthObservationPage: async (
          ...args: Parameters<typeof lane.repository.listHealthObservationPage>
        ) => {
          const page = await lane.repository.listHealthObservationPage(...args);
          return changed
            ? {
                ...page,
                records: page.records.map(row =>
                  row.id === lane.first.id && row.provenance.source
                    ? {
                        ...row,
                        provenance: {
                          ...row.provenance,
                          source: {
                            ...row.provenance.source,
                            sourceIdentifier: 'synthetic-changed-source',
                          },
                        },
                      }
                    : row,
                ),
              }
            : page;
        },
      };
      lane.queryWorkoutPeriodHeartRate.mockImplementation(async request => {
        if (mode === 'during-native') changed = true;
        return {
          ...resultFor(request),
          workoutCohortPolicy: 'exact-visible-native-cohort',
        };
      });
      const witness = await lane.read(
        readLocalConversationWorkoutPeriod,
        repository,
      );
      if (mode === 'during-native') expect(witness.result).toBeUndefined();
      else {
        expect(witness.result?.status).toBe('available');
        changed = true;
      }
      expect(await witness.reprove()).toBe(false);
    } finally {
      lane.close();
    }
  },
);
