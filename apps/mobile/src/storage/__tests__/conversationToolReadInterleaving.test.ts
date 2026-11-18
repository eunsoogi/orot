import { periodContributorFixture } from '../testSupport/periodContributorFixture';

/** Native imports/deletions can interleave on the transaction's connection. */
test.each(['abort', 'generation'] as const)(
  'scoped tool validation preserves an interleaved health DELETE on %s',
  async mode => {
    const f = await periodContributorFixture('heart_rate', 'measurements');
    const controller = new AbortController();
    const scope = f.conversation.beginReadOperation(controller.signal)!;
    const transaction = f.database.transaction.bind(f.database);
    let injected = false;
    try {
      f.database.transaction = work =>
        transaction(async tx => {
          const execute = tx.execute.bind(tx);
          await work({
            ...tx,
            execute: async (...args) => {
              const result = await execute(...args);
              if (
                !injected &&
                args[0].includes('observations AS MATERIALIZED')
              ) {
                injected = true;
                await execute('DELETE FROM health_observations WHERE id=?', [
                  f.candidate.id,
                ]);
                if (mode === 'abort') controller.abort();
              }
              return result;
            },
          });
        });
      await expect(scope.readToolTurnsSnapshot('session', 0)).rejects.toThrow();
      expect(injected).toBe(true);
      expect(
        (
          await f.database.execute(
            'SELECT id FROM health_observations WHERE id=?',
            [f.candidate.id],
          )
        ).rows,
      ).toEqual([]);
      f.database.transaction = transaction;
      scope.dispose();
      expect(
        (await f.conversation.readToolTurnsSnapshot('session', 0)).items,
      ).toEqual([]);
    } finally {
      f.database.transaction = transaction;
      scope.dispose();
      f.close();
    }
  },
);

// An operational query failure is not reclassified merely because abort raced it.
test('scoped query failure retains its original error and rollback on concurrent abort', async () => {
  const f = await periodContributorFixture('heart_rate', 'measurements');
  const controller = new AbortController();
  const scope = f.conversation.beginReadOperation(controller.signal)!;
  const transaction = f.database.transaction.bind(f.database);
  const failure = new Error('Synthetic query failure');
  try {
    await f.database.execute(
      'CREATE TABLE synthetic_failed_query(value INTEGER)',
    );
    f.database.transaction = work =>
      transaction(async tx => {
        const execute = tx.execute.bind(tx);
        await work({
          ...tx,
          execute: async (...args) => {
            if (args[0].includes('observations AS MATERIALIZED')) {
              await execute('INSERT INTO synthetic_failed_query VALUES (1)');
              controller.abort();
              throw failure;
            }
            return execute(...args);
          },
        });
      });
    await expect(scope.readToolTurnsSnapshot('session', 0)).rejects.toBe(
      failure,
    );
    expect(
      (await f.database.execute('SELECT * FROM synthetic_failed_query')).rows,
    ).toEqual([]);
  } finally {
    f.database.transaction = transaction;
    scope.dispose();
    f.close();
  }
});
