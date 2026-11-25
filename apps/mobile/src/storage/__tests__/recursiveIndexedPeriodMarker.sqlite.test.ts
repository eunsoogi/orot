import { markerPeriodContributorMatches } from '../markerPeriodContributors';
import { periodRemovalIndexDefinitions } from '../periodRemovalIndexes';
import { fixture, previous } from '../testSupport/periodMarkerAffinityFixture';

test.each([true, false])(
  'recursive marker effects and rollback stay atomic (%s old predicate)',
  async old => {
    const f = await fixture('health_observations');
    try {
      await f.segment('seg-a', 'root-a', 'family-a');
      await f.segment('seg-b', 'root-b', 'family-b');
      await f.put('remove-a', ['family-a']);
      await f.put('remove-b', ['seg-b']);
      await f.put('retain', ['unrelated']);
      await f.database.execute('PRAGMA recursive_triggers = ON');
      for (const definition of periodRemovalIndexDefinitions(
        'health_observations',
      ))
        await f.database.execute(definition.sql);
      const match = old
        ? `EXISTS (SELECT 1 FROM health_observations h WHERE h.id = known.id AND ${previous('NEW.source_id', 'agent_memory_removed_sources', 'health_observation')})`
        : markerPeriodContributorMatches(
            'health_observations',
            'NEW.source_id',
            'agent_memory_removed_sources',
            'health_observation',
            'h.id = known.id',
            true,
          );
      await f.database
        .execute(`CREATE TRIGGER fixture_marker_removal AFTER INSERT ON agent_memory_removed_sources BEGIN
        DELETE FROM health_observations WHERE id IN (SELECT known.id FROM health_observations known WHERE ${match});
        INSERT OR IGNORE INTO agent_memory_removed_sources (source_id) SELECT 'root-b' WHERE NEW.source_id='root-a';
      END`);
      const rows = 'SELECT id FROM health_observations ORDER BY id';
      await expect(
        f.database.transaction(async transaction => {
          await transaction.execute(
            "INSERT INTO agent_memory_removed_sources VALUES ('root-a')",
          );
          expect((await transaction.execute(rows)).rows).toEqual([
            { id: 'retain' },
          ]);
          expect(
            (
              await transaction.execute(
                'SELECT source_id FROM agent_memory_removed_sources ORDER BY source_id',
              )
            ).rows,
          ).toEqual([{ source_id: 'root-a' }, { source_id: 'root-b' }]);
          throw new Error('fixture rollback');
        }),
      ).rejects.toThrow('fixture rollback');
      expect((await f.database.execute(rows)).rows).toEqual([
        { id: 'remove-a' },
        { id: 'remove-b' },
        { id: 'retain' },
      ]);
      expect(
        (
          await f.database.execute(
            'SELECT source_id FROM agent_memory_removed_sources',
          )
        ).rows,
      ).toEqual([]);
    } finally {
      f.close();
    }
  },
);
