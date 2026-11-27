import { createRecordRepository, runMigrations } from '@orot/storage';
import { syncCommonObservationChanges } from '../../healthkit/commonObservations/sync';
import {
  healthKit,
  page,
} from '../../healthkit/commonObservations/testSyncSupport';
import { healthKitSample } from '../../healthkit/commonObservations/testSupport';
import { openOpSqliteFileQueue } from '../../../test-support/opSqliteFileQueueFixture';
import {
  acquireIndependentReadEpoch,
  acquireWorkoutReadEpoch,
  guardedNativeDatabase,
} from '../protectedReadEpoch';
import {
  bindProtectedLocalRepositories,
  tryAdvanceStepAnchor,
} from '../workoutStepAnchorContract';

const key = 'healthkit:steps:steps';
const now = () => '2035-01-01T00:00:00.000Z';

test('the cursor capability admits only an exact guarded stock store; generic readers remain fenced', async () => {
  const f = openOpSqliteFileQueue();
  const other = openOpSqliteFileQueue();
  try {
    const adapter = {
      ...f.database,
      executeAsync: f.database.execute.bind(f.database),
    };
    const owner = guardedNativeDatabase(adapter);
    const foreign = guardedNativeDatabase(other.database);
    await runMigrations(owner);
    await runMigrations(foreign);
    const records = createRecordRepository(owner);
    const raw = createRecordRepository(other.database);
    expect(tryAdvanceStepAnchor(records, null, 'next', now)).toBeUndefined();
    const wrong = bindProtectedLocalRepositories(records, foreign, () => true);
    expect(tryAdvanceStepAnchor(wrong, null, 'next', now)).toBeUndefined();
    bindProtectedLocalRepositories(raw, other.database, () => true);
    expect(tryAdvanceStepAnchor(raw, null, 'next', now)).toBeUndefined();
    expect(await records.getSyncCheckpoint(key)).toBeNull();
    const bound = bindProtectedLocalRepositories(records, owner, () => true);
    const broad = acquireIndependentReadEpoch(owner);
    const scoped = acquireWorkoutReadEpoch(owner);
    try {
      await expect(
        tryAdvanceStepAnchor(bound, null, 'next', now)!(),
      ).resolves.toBe(true);
      expect(await records.getSyncCheckpoint(key)).toEqual({
        key,
        value: 'next',
        updatedAt: now(),
      });
      expect(await raw.getSyncCheckpoint(key)).toBeNull();
      expect(broad?.current()).toBe(false);
      expect(scoped?.current()).toBe(true);
      await expect(
        tryAdvanceStepAnchor(
          bound,
          'retired-anchor',
          'unexpected-update',
          now,
        )!(),
      ).rejects.toThrow('step cursor changed');
      expect((await records.getSyncCheckpoint(key))?.value).toBe('next');
      expect(scoped?.current()).toBe(true);
      // No general checkpoint name or cursor designation can bypass the workout fence.
      await records.putSyncCheckpoint({
        key,
        value: 'general-api',
        updatedAt: now(),
      });
      expect(scoped?.current()).toBe(false);
      const unknown = acquireWorkoutReadEpoch(owner);
      try {
        await owner.executeAsync(
          'UPDATE healthkit_sync_checkpoints SET value = ? WHERE checkpoint_key = ?',
          ['opaque-alias', key],
        );
        expect(unknown?.current()).toBe(false);
      } finally {
        unknown?.dispose();
      }
    } finally {
      broad?.dispose();
      scoped?.dispose();
    }
  } finally {
    await f.close();
    await other.close();
  }
});

test('a step anchor combined with source records remains a generic protected writer', async () => {
  const f = openOpSqliteFileQueue();
  const owner = guardedNativeDatabase(f.database);
  try {
    await runMigrations(owner);
    const records = bindProtectedLocalRepositories(
      createRecordRepository(owner),
      owner,
      () => true,
    );
    const epoch = acquireWorkoutReadEpoch(owner);
    try {
      const result = await syncCommonObservationChanges({
        feature: 'steps',
        repository: records,
        permissionPreviouslyRequested: true,
        now,
        healthKit: healthKit([
          page({
            cursor: 'with-source',
            addedSamples: [healthKitSample('steps')],
          }),
        ]),
      });
      expect(result).toMatchObject({
        cursorAdvanced: true,
        upserted: 1,
        deleted: 0,
      });
      expect(epoch?.current()).toBe(false);
      expect((await records.getSyncCheckpoint(key))?.value).toBe('with-source');
    } finally {
      epoch?.dispose();
    }
  } finally {
    await f.close();
  }
});

test('a proved, scoped dispatch with an uncertain native settlement poisons future admission', async () => {
  const f = openOpSqliteFileQueue();
  let refuseReceipt = false;
  const owner = guardedNativeDatabase({
    ...f.database,
    async transaction(callback: Parameters<typeof f.database.transaction>[0]) {
      await f.database.transaction(callback);
      if (refuseReceipt) throw new Error('native settlement uncertainty');
    },
  });
  try {
    await runMigrations(owner);
    const records = bindProtectedLocalRepositories(
      createRecordRepository(owner),
      owner,
      () => true,
    );
    const existing = acquireWorkoutReadEpoch(owner);
    try {
      refuseReceipt = true;
      await expect(
        tryAdvanceStepAnchor(records, null, 'next', now)!(),
      ).rejects.toThrow('settlement uncertainty');
      expect(existing?.current()).toBe(false);
      expect(acquireWorkoutReadEpoch(owner)).toBeUndefined();
      expect(acquireIndependentReadEpoch(owner)).toBeUndefined();
      const submit = jest.fn();
      f.observeSubmit(submit);
      await expect(
        syncCommonObservationChanges({
          feature: 'steps',
          repository: records,
          permissionPreviouslyRequested: true,
          now,
          healthKit: healthKit([page({ cursor: 'must-not-fallback' })]),
        }),
      ).rejects.toThrow('owner unavailable');
      expect(submit.mock.calls.map(([query]) => query)).not.toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^INSERT INTO .*healthkit_sync_checkpoints/),
        ]),
      );
    } finally {
      existing?.dispose();
    }
  } finally {
    await f.close();
  }
});

test('statement-local RETURNING receipt, not connection-global changes, determines success', async () => {
  const f = openOpSqliteFileQueue();
  let badReceipt = false;
  const owner = guardedNativeDatabase({
    ...f.database,
    transaction(operation: Parameters<typeof f.database.transaction>[0]) {
      return f.database.transaction(tx =>
        operation({
          ...tx,
          async execute(query, bindings) {
            const result = await tx.execute(query, bindings);
            if (!query.includes('RETURNING 1 AS advanced')) return result;
            return badReceipt
              ? { rows: [{ advanced: 0 }], rowsAffected: 1 }
              : { ...result, rowsAffected: 0 };
          },
        }),
      );
    },
  });
  try {
    await runMigrations(owner);
    const records = bindProtectedLocalRepositories(
      createRecordRepository(owner),
      owner,
      () => true,
    );
    await expect(
      tryAdvanceStepAnchor(records, null, 'first', now)!(),
    ).resolves.toBe(true);
    badReceipt = true;
    await expect(
      tryAdvanceStepAnchor(records, 'first', 'second', now)!(),
    ).rejects.toThrow('receipt invalid');
    expect(acquireWorkoutReadEpoch(owner)).toBeUndefined();
  } finally {
    await f.close();
  }
});

test('an altered schema and a retired guarded store cannot claim a scoped write', async () => {
  const f = openOpSqliteFileQueue();
  const owner = guardedNativeDatabase(f.database);
  let current = true;
  try {
    await runMigrations(owner);
    const records = bindProtectedLocalRepositories(
      createRecordRepository(owner),
      owner,
      () => current,
    );
    await owner.execute(
      'ALTER TABLE healthkit_sync_checkpoints ADD COLUMN unrelated TEXT',
    );
    await expect(
      tryAdvanceStepAnchor(records, null, 'next', now)!(),
    ).resolves.toBe(false);
    expect(await records.getSyncCheckpoint(key)).toBeNull();
    current = false;
    await expect(
      tryAdvanceStepAnchor(records, null, 'next', now)!(),
    ).rejects.toThrow('owner expired');
    expect(await records.getSyncCheckpoint(key)).toBeNull();
  } finally {
    await f.close();
  }
});
