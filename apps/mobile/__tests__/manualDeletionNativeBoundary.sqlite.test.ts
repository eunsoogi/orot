import { openSqliteTestDatabase } from '../../../packages/storage/__tests__/sqliteTestDatabase';
import { observeManualHistoryDeletionSql } from '../src/memory/observeManualHistoryDeletionSql';
import {
  manualHistoryMemoryDelete,
  savedMemoryDeleteExecutor,
  type GuardedMutationBoundary,
} from '../src/storage/guardedMutationBoundary';
import {
  acquireIndependentReadEpoch,
  guardedNativeDatabase,
} from '../src/storage/protectedReadEpoch';

async function fixture() {
  const f = openSqliteTestDatabase(':memory:');
  await f.database.execute(
    'CREATE TABLE manual_history_entries (id TEXT PRIMARY KEY)',
  );
  for (const id of ['ordinary', 'scoped'])
    await f.database.execute('INSERT INTO manual_history_entries VALUES (?)', [
      id,
    ]);
  const trace = jest.fn<
    ReturnType<GuardedMutationBoundary>,
    Parameters<GuardedMutationBoundary>
  >();
  const owner = guardedNativeDatabase(f.database, trace);
  const rows = () =>
    owner.execute('SELECT id FROM manual_history_entries ORDER BY id');
  return { ...f, owner, rows, trace };
}

test('only the explicit Saved Memory observer uses the fixed native boundary', async () => {
  const f = await fixture();
  try {
    let expired: ReturnType<typeof savedMemoryDeleteExecutor>;
    await f.owner.transaction(async tx => {
      expired = savedMemoryDeleteExecutor(tx);
      await tx.execute(manualHistoryMemoryDelete, ['ordinary']);
    });
    expect(f.trace).not.toHaveBeenCalled();
    await expect(expired!('scoped')).rejects.toThrow('no longer active');
    expect((await f.rows()).rows).toEqual([{ id: 'scoped' }]);
    await f.owner.transaction(async tx => {
      const memory = observeManualHistoryDeletionSql(tx, () => undefined);
      await memory.execute(manualHistoryMemoryDelete, ['scoped']);
    });
    expect(f.trace.mock.calls).toEqual([
      ['retirement', 'started'],
      ['retirement', 'completed'],
      ['submission', 'started'],
      ['submission', 'completed'],
      ['settlement', 'started'],
      ['settlement', 'completed'],
    ]);
    expect((await f.rows()).rows).toEqual([]);
  } finally {
    f.close();
  }
});

test('retirement failure cannot submit or change the original rollback boundary', async () => {
  const f = await fixture();
  try {
    const lease = acquireIndependentReadEpoch(f.owner)!;
    const remove = lease.beforeDispatch(() => {
      throw new Error('Synthetic retirement failure');
    });
    try {
      await expect(
        f.owner.transaction(async tx => {
          await observeManualHistoryDeletionSql(tx, () => undefined).execute(
            manualHistoryMemoryDelete,
            ['scoped'],
          );
        }),
      ).rejects.toThrow('Synthetic retirement failure');
    } finally {
      remove?.();
      lease.dispose();
    }
    expect(f.trace.mock.calls).toEqual([
      ['retirement', 'started'],
      ['retirement', 'failed'],
    ]);
    expect((await f.rows()).rows).toEqual([
      { id: 'ordinary' },
      { id: 'scoped' },
    ]);
  } finally {
    f.close();
  }
});
