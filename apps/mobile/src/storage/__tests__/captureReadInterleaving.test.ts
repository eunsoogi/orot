import { diverseHistoryProfileFixture } from '../../aiFeatures/integration/testSupport/diverseHistoryProfileFixture';

/** Native imports/deletions can interleave on the transaction's connection. */
test.each(['abort', 'generation'] as const)(
  'capture strict validation preserves an interleaved health DELETE on %s',
  async mode => {
    const f = await diverseHistoryProfileFixture(1, false);
    const controller = new AbortController();
    const scope = f.storage.beginReadOperation(controller.signal, {
      rollbackOnFailure: true,
    })!;
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
                  f.inside.id,
                ]);
                if (mode === 'abort') controller.abort();
              }
              return result;
            },
          });
        });
      await expect(scope.readMany(['turn-0'])).rejects.toThrow();
      expect(injected).toBe(true);
      expect(
        (
          await f.database.execute(
            'SELECT id FROM health_observations WHERE id=?',
            [f.inside.id],
          )
        ).rows,
      ).toEqual([]);
      f.database.transaction = transaction;
      scope.dispose();
      expect(await f.storage.readMany(['turn-0'])).toEqual([null]);
    } finally {
      f.database.transaction = transaction;
      scope.dispose();
      f.close();
    }
  },
);

// An operational query failure is not reclassified merely because abort raced it.
test('scoped query failure retains its original error and rollback on concurrent abort', async () => {
  const f = await diverseHistoryProfileFixture(1, false);
  const controller = new AbortController();
  const scope = f.storage.beginReadOperation(controller.signal, {
    rollbackOnFailure: true,
  })!;
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
    await expect(scope.readMany(['turn-0'])).rejects.toBe(failure);
    expect(
      (await f.database.execute('SELECT * FROM synthetic_failed_query')).rows,
    ).toEqual([]);
  } finally {
    f.database.transaction = transaction;
    scope.dispose();
    f.close();
  }
});

/** A failed calculation cannot seed a subsequent successful capture or escaped read. */
test('strict capture failure publishes no report and disposal restores independent calculation', async () => {
  const f = await diverseHistoryProfileFixture(1, false);
  const scope = f.storage.beginReadOperation(undefined, {
    rollbackOnFailure: true,
  })!;
  const transaction = f.database.transaction.bind(f.database);
  let reads = 0;
  const failure = new Error('Synthetic post-query failure');
  try {
    f.database.transaction = work =>
      transaction(async tx => {
        const execute = tx.execute.bind(tx);
        await work({
          ...tx,
          execute: async (...args) => {
            const result = await execute(...args);
            if (args[0].includes('observations AS MATERIALIZED')) {
              reads++;
              if (reads === 1) throw failure;
            }
            return result;
          },
        });
      });
    await expect(scope.read('turn-0')).rejects.toBe(failure);
    expect(await scope.read('turn-0')).not.toBeNull();
    expect(reads).toBe(2);
    expect(await scope.read('turn-0')).not.toBeNull();
    expect(reads).toBe(2);
    scope.dispose();
    expect(await scope.read('turn-0')).not.toBeNull();
    expect(reads).toBe(3);
  } finally {
    f.database.transaction = transaction;
    scope.dispose();
    f.close();
  }
});
