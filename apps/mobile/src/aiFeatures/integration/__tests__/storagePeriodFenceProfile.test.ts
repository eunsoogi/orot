import { sharedAncestryProfileFixture } from '../testSupport/sharedAncestryProfileFixture';

/** Synthetic SQL observation only: initial and final authoritative storage fences
 * retain every query and transaction, including repeated root/parent validation. */
test('storage fences repeat the same six exact period calculations across transactions', async () => {
  const f = await sharedAncestryProfileFixture(6, true);
  const transaction = f.database.transaction.bind(f.database);
  const batches: { aggregates: string[]; summaryReads: number }[] = [];
  f.database.transaction = async operation =>
    transaction(async tx => {
      const batch = { aggregates: [] as string[], summaryReads: 0 };
      batches.push(batch);
      const execute = tx.execute.bind(tx);
      tx.execute = async (...args) => {
        if (/WITH days\(/.test(args[0]))
          batch.aggregates.push(JSON.stringify(args[1]));
        if (
          args[0] ===
          'SELECT result_json FROM symptom_summary_runs WHERE id = ?'
        )
          batch.summaryReads++;
        return execute(...args);
      };
      await operation(tx);
    });
  try {
    const ids = Array.from({ length: 6 }, (_, i) => `dag-turn-${i}`);
    const initial = await f.storage.readManyWithAncestry(ids);
    const final = await f.storage.readMany(ids);
    expect(initial.items).toEqual(final);
    expect(batches).toHaveLength(2);
    expect(batches.map(batch => batch.aggregates.length)).toEqual([12, 12]);
    expect(batches.map(batch => batch.summaryReads)).toEqual([63, 63]);
    expect(batches[0]!.aggregates).toEqual(batches[1]!.aggregates);
    // Each exact scope invokes quantity and heart-rate/activity context SQL.
    expect(new Set(batches[0]!.aggregates).size).toBe(12);
    console.info(
      JSON.stringify({
        stage: 'initial-final-storage-fences',
        batches: batches.map(batch => ({
          aggregates: batch.aggregates.length,
          exactParameterSets: new Set(batch.aggregates).size,
          calendars: new Set(
            batch.aggregates.map(value => JSON.parse(value)[0]),
          ).size,
          summaryReads: batch.summaryReads,
        })),
        sameParametersAcrossFences: true,
      }),
    );
  } finally {
    f.database.transaction = transaction;
    f.close();
  }
});
