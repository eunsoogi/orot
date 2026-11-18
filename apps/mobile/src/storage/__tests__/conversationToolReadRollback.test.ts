import { periodContributorFixture } from '../testSupport/periodContributorFixture';

/** Index backfills and operational failures retain the existing all-or-nothing snapshot contract. */
test.each(['history', 'scoped-history', 'strict-live'] as const)(
  'tool %s read rolls back indexing failure without replacing the original error',
  async mode => {
    const f = await periodContributorFixture('heart_rate', 'measurements');
    const scope = f.conversation.beginReadOperation()!;
    const transaction = f.database.transaction.bind(f.database);
    const failure = new Error('Synthetic tool indexing failure');
    try {
      await scope.readMany(['turn']);
      await f.database.execute(
        'CREATE TABLE synthetic_snapshot_writes(value INTEGER)',
      );
      f.database.transaction = work =>
        transaction(async tx => {
          const execute = tx.execute.bind(tx);
          await work({
            ...tx,
            execute: async (...args) => {
              if (
                args[0].startsWith(
                  'INSERT OR IGNORE INTO conversation_tool_periods',
                )
              ) {
                await execute(
                  'INSERT INTO synthetic_snapshot_writes VALUES (1)',
                );
                throw failure;
              }
              return execute(...args);
            },
          });
        });
      const read =
        mode === 'scoped-history'
          ? scope.readToolTurnsSnapshot
          : mode === 'strict-live'
            ? f.conversation.readToolTurns
            : f.conversation.readToolTurnsSnapshot;
      await expect(read('session', 0)).rejects.toBe(failure);
      expect(
        (await f.database.execute('SELECT * FROM synthetic_snapshot_writes'))
          .rows,
      ).toEqual([]);
      f.database.transaction = transaction;
      const snapshot = await scope.readToolTurnsSnapshot('session', 0);
      expect(snapshot.items).toHaveLength(1);
      expect(snapshot.unavailable).toEqual([]);
    } finally {
      f.database.transaction = transaction;
      scope.dispose();
      f.close();
    }
  },
);

/** A report from another database never supplies an authority capability to tool reads. */
test('foreign tool reader and disposed operation always use their own strict owner', async () => {
  const f = await periodContributorFixture('heart_rate', 'measurements');
  const other = await periodContributorFixture('heart_rate', 'measurements');
  try {
    const mixed = {
      ...f.conversation,
      readToolTurnsSnapshot: other.conversation.readToolTurnsSnapshot,
    };
    expect(mixed.beginReadOperation()).toBeUndefined();
    const scope = f.conversation.beginReadOperation()!;
    await scope.readToolTurnsSnapshot('session', 0);
    scope.dispose();
    await f.repository.delete('health_observation', f.candidate.id);
    expect((await scope.readToolTurnsSnapshot('session', 0)).items).toEqual([]);
    expect(
      (await other.conversation.readToolTurnsSnapshot('session', 0)).items,
    ).toHaveLength(1);
  } finally {
    f.close();
    other.close();
  }
});
