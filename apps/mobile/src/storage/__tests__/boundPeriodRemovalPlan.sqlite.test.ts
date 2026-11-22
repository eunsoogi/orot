import {
  assertPlannedPeriodNotRemoved,
  withBoundPeriodRemovalPlan,
} from '../boundPeriodRemovalPlan';
import {
  BoundReadWitnessUnavailable,
  createBoundReadResultWitness,
  guardedBoundTransaction,
} from '../boundReadResultWitness';
import { guardedNativeDatabase } from '../protectedReadEpoch';
import { periodContributorFixture } from '../testSupport/periodContributorFixture';

const membership = 'linked_ids(id) AS (';

test('one stock period task per exact binding tuple only inside one witnessed read', async () => {
  const f = await periodContributorFixture('heart_rate', 'measurements', false);
  const database = guardedNativeDatabase(f.database);
  const witness = createBoundReadResultWitness(database, () => true)!;
  let reads = 0;
  const wider = {
    ...f.source,
    scope: {
      ...f.source.scope,
      window: {
        ...f.source.scope.window,
        toExclusive: '2026-10-06T00:00:00.000Z',
      },
    },
  };
  try {
    await guardedBoundTransaction(
      database,
      witness,
      tx =>
        withBoundPeriodRemovalPlan(tx, witness, async () => {
          await assertPlannedPeriodNotRemoved(tx, f.source);
          await assertPlannedPeriodNotRemoved(tx, {
            ...f.source,
            revision: 'distinct-synthetic-revision',
          });
          await assertPlannedPeriodNotRemoved(tx, wider);
          await assertPlannedPeriodNotRemoved(tx, wider);
        }),
      tx => ({
        execute(sql, binds) {
          if (sql.includes(membership)) reads++;
          return tx.execute(sql, binds);
        },
      }),
    );
    // Two different SQL tuples, four original marker SELECTs each.
    expect(reads).toBe(8);
    await assertPlannedPeriodNotRemoved(database, f.source);
    // Stock path still independently sees a later authoritative deletion.
    await database.execute(
      'INSERT INTO agent_memory_removed_sources(source_id) VALUES (?)',
      [f.candidate.id],
    );
    await expect(
      assertPlannedPeriodNotRemoved(database, f.source),
    ).rejects.toThrow('A period source was removed.');
  } finally {
    witness.dispose();
    f.close();
  }
});

test('a guarded mutation refuses an already planned tuple and stock sees the marker', async () => {
  const f = await periodContributorFixture('heart_rate', 'measurements', false);
  const database = guardedNativeDatabase(f.database);
  const witness = createBoundReadResultWitness(database, () => true)!;
  let insertMarker: (() => Promise<unknown>) | undefined;
  try {
    await expect(
      guardedBoundTransaction(
        database,
        witness,
        tx =>
          withBoundPeriodRemovalPlan(tx, witness, async () => {
            await assertPlannedPeriodNotRemoved(tx, f.source);
            await insertMarker!();
            await assertPlannedPeriodNotRemoved(tx, f.source);
          }),
        tx => {
          insertMarker = () =>
            tx.execute(
              'INSERT INTO source_deletion_tombstones(source_id) VALUES (?)',
              [f.candidate.id],
            );
          return tx;
        },
      ),
    ).rejects.toBeInstanceOf(BoundReadWitnessUnavailable);
    await expect(
      assertPlannedPeriodNotRemoved(database, f.source),
    ).rejects.toThrow('A period source was removed.');
  } finally {
    witness.dispose();
    f.close();
  }
});
