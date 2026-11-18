import { assertPeriodNotRemoved } from '../conversationPeriodRemoval';
import { periodContributorFixture } from '../testSupport/periodContributorFixture';

/** Exercise the shipping validator, not just SQL generation, across transaction fences. */
test.each([false, true])(
  'preserves live marker checks and rollback for workout=%s',
  async workout => {
    const f = await periodContributorFixture(
      workout ? 'workout_duration' : 'heart_rate',
      'measurements',
      workout,
    );
    try {
      let reads = 0;
      const execute = f.database.execute.bind(f.database);
      f.database.execute = async (sql, args) => {
        if (sql.includes('linked_ids(id) AS')) reads++;
        return execute(sql, args);
      };
      await assertPeriodNotRemoved(f.database, f.source);
      expect(reads).toBe(4);
      await expect(
        f.database.transaction(async tx => {
          await tx.execute(
            'INSERT INTO source_deletion_tombstones(source_id) VALUES (?)',
            [f.candidate.id],
          );
          await expect(assertPeriodNotRemoved(tx, f.source)).rejects.toThrow(
            'A period source was removed.',
          );
          throw new Error('synthetic rollback');
        }),
      ).rejects.toThrow('synthetic rollback');
      await assertPeriodNotRemoved(f.database, f.source);
      expect(reads).toBe(8);
      const failure = new Error('synthetic SQLite failure');
      await expect(
        assertPeriodNotRemoved(
          {
            execute: async () => {
              throw failure;
            },
          },
          f.source,
        ),
      ).rejects.toBe(failure);
      // A subsequent invocation still queries the database; no prior verdict is cached.
      await execute(
        'INSERT INTO agent_memory_removed_sources(source_id) VALUES (?)',
        [f.candidate.id],
      );
      await expect(
        assertPeriodNotRemoved(f.database, f.source),
      ).rejects.toThrow('A period source was removed.');
      for (const topic of ['', null, 'unknown']) {
        await expect(
          assertPeriodNotRemoved(f.database, {
            ...f.source,
            scope: { ...f.source.scope, topic: topic as never },
          }),
        ).rejects.toThrow('Unknown topic');
      }
    } finally {
      f.close();
    }
  },
);
