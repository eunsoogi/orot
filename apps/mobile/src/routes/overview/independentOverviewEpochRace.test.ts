import { openOpSqliteFileQueue } from '../../../test-support/opSqliteFileQueueFixture';
import {
  guardedNativeDatabase,
  acquireIndependentReadEpoch,
  acquireProtectedReadEpoch,
} from '../../storage/protectedReadEpoch';
import { readIndependentOverviewSnapshot } from './independentOverviewSnapshot';
import {
  gate,
  project,
  readonlyOpen,
  seed,
} from './testSupport/overviewReadOnlySnapshotFixture';

test.each(['via transaction', 'via direct connection'])(
  'reject an implicit COMMIT that settles after final cross-handle data_version has already been sampled (%s)',
  async dispatch => {
    const f = openOpSqliteFileQueue();
    const held = gate();
    const release = gate();
    const writer = guardedNativeDatabase(f.database);
    let writing: Promise<void> | undefined;
    let epoch: ReturnType<typeof acquireIndependentReadEpoch>;
    try {
      await f.database.execute('PRAGMA journal_mode=WAL');
      await seed(f.database);
      writing = writer.transaction(async tx => {
        await (dispatch === 'via transaction' ? tx : writer).execute(
          'DELETE FROM health_observations WHERE id = ?',
          ['sample'],
        );
        held.release();
        await release.reached;
      });
      await held.reached;
      epoch = acquireIndependentReadEpoch(writer);
      let versions = 0;
      const publish = jest.fn();
      const outcome = await readIndependentOverviewSnapshot(
        () =>
          readonlyOpen(
            f.filename,
            () => {},
            async () => {
              if (++versions === 2) {
                // The reader is handing off an old sampled version. The production
                // scheduler now performs an unobservable implicit COMMIT before it resolves.
                release.release();
                await writing;
              }
            },
          ),
        () => epoch?.current() === true,
        async () => true,
        project,
        publish,
      );
      expect(outcome).toBe('discarded');
      expect(publish).not.toHaveBeenCalled();
    } finally {
      epoch?.dispose();
      release.release();
      await Promise.allSettled([writing]);
      await f.close();
    }
  },
);

test('a known callback failure holds the gate through rollback then permits fresh independent reads', async () => {
  const f = openOpSqliteFileQueue();
  const held = gate();
  const release = gate();
  const owner = guardedNativeDatabase(f.database);
  const failure = new Error('synthetic callback abort');
  let writing: Promise<void> | undefined;
  try {
    await seed(f.database);
    writing = owner.transaction(async tx => {
      await tx.execute('DELETE FROM health_observations');
      held.release();
      await release.reached;
      throw failure;
    });
    await held.reached;
    expect(acquireIndependentReadEpoch(owner)).toBeUndefined();
    const literal = acquireProtectedReadEpoch(owner);
    expect(literal?.current()).toBe(true);
    literal?.dispose();
    release.release();
    await expect(writing).rejects.toBe(failure);
    const next = acquireIndependentReadEpoch(owner);
    expect(next?.current()).toBe(true);
    next?.dispose();
    const row = await owner.execute(
      'SELECT COUNT(*) AS count FROM health_observations',
    );
    expect(row.rows[0]?.count).toBe(1);
  } finally {
    release.release();
    await Promise.allSettled([writing]);
    await f.close();
  }
});

test('an unconfirmed dirty native settlement is fail-closed for independent readers only', async () => {
  const db = guardedNativeDatabase({
    async execute() {
      return { rows: [] };
    },
    async transaction(
      callback: Parameters<
        import('@orot/storage').SqlDatabase['transaction']
      >[0],
    ) {
      await callback({
        async execute() {
          return { rows: [] };
        },
        commit: () => {
          throw new Error('synthetic commit failure');
        },
        rollback: () => {
          throw new Error('synthetic rollback failure');
        },
      });
      throw new Error('synthetic native settlement failure');
    },
  });
  await expect(
    db.transaction(async tx => {
      await tx.execute('DELETE FROM health_observations');
    }),
  ).rejects.toThrow('settlement failure');
  expect(acquireIndependentReadEpoch(db)).toBeUndefined();
  const literal = acquireProtectedReadEpoch(db);
  expect(literal?.current()).toBe(true);
  literal?.dispose();
});

test.each([
  ['DELETE FROM', 'discarded'],
  ['SELECT id FROM', 'published'],
] as const)(
  'a direct %s already queued when BEGIN executes is classified through native settlement',
  async (command, expected) => {
    const f = openOpSqliteFileQueue();
    const worker = gate();
    const admitted = gate();
    const release = gate();
    const owner = guardedNativeDatabase(f.database);
    let direct: ReturnType<typeof owner.execute> | undefined;
    let writing: Promise<void> | undefined;
    let revoke: (() => void) | undefined;
    try {
      await f.database.execute('PRAGMA journal_mode=WAL');
      await seed(f.database);
      const statement = `${command} health_observations WHERE id = ?`;
      f.delayWorker(async query => {
        if (query === statement) await worker.reached;
      });
      direct = owner.execute(statement, ['sample']);
      writing = owner.transaction(async () => {
        admitted.release();
        await release.reached;
      });
      await admitted.reached; // Pinned synchronous BEGIN has already returned.
      worker.release();
      await direct; // Delete joined the transaction and its individual Promise settled.
      const epoch = acquireIndependentReadEpoch(owner);
      revoke = epoch?.dispose;
      const publish = jest.fn();
      let versions = 0;
      const outcome = await readIndependentOverviewSnapshot(
        () =>
          readonlyOpen(
            f.filename,
            () => {},
            async () => {
              if (++versions !== 2) return;
              release.release();
              await writing;
            },
          ),
        () => epoch?.current() === true,
        async () => true,
        project,
        publish,
      );
      expect(outcome).toBe(expected);
      expect(publish).toHaveBeenCalledTimes(expected === 'published' ? 1 : 0);
    } finally {
      revoke?.();
      worker.release();
      release.release();
      await Promise.allSettled([direct, writing]);
      await f.close();
    }
  },
);
