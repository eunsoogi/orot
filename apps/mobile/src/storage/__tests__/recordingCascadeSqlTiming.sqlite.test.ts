import {
  fixture,
  row,
  sourceId,
} from '../testSupport/agentMemoryCascadeFixture';

const faults = [
  ['batch-state-read', 'SELECT source_id FROM agent_memory_removed_sources'],
  ['batch-record-writes', 'DELETE FROM agent_memory_records WHERE id = ?'],
  ['batch-fence-writes', 'INSERT OR IGNORE INTO agent_memory_removed_sources'],
  ['batch-settlement', ''],
] as const;

test.each(faults)(
  'reports a failed %s without returning a committed source receipt',
  async (failedPhase, sqlPrefix) => {
    const f = await fixture();
    try {
      await f.seed(row('scope-linked-fixture', sourceId));
      const memory = await f.openMemory();
      const transaction = f.database.transaction.bind(f.database);
      const probeEvents: [string, string][] = [];
      const original = new Error('synthetic SQL failure is not a diagnostic');
      let installed = false;

      await expect(
        memory.removeSource(
          sourceId,
          f.receipt,
          [],
          undefined,
          (phase, outcome) => {
            probeEvents.push([phase, outcome]);
            if (installed || phase !== 'batch-admission' || outcome !== 'begin')
              return;
            installed = true;
            jest
              .spyOn(f.database, 'transaction')
              .mockImplementationOnce(operation =>
                transaction(async sql => {
                  await operation({
                    ...sql,
                    execute: (query, params) => {
                      if (sqlPrefix.length && query.startsWith(sqlPrefix))
                        return Promise.reject(original);
                      return sql.execute(query, params);
                    },
                  });
                  if (failedPhase === 'batch-settlement') throw original;
                }),
              );
          },
        ),
      ).rejects.toBe(original);

      expect(probeEvents).toContainEqual(['batch-admission', 'success']);
      expect(probeEvents).toContainEqual([failedPhase, 'failure']);
      expect(probeEvents).toContainEqual(['batch-settlement', 'failure']);
      expect(probeEvents).not.toContainEqual(['batch-settlement', 'success']);
      expect(JSON.stringify(probeEvents)).not.toContain(sourceId);
      expect(JSON.stringify(probeEvents)).not.toContain(original.message);
      expect(f.receipt).not.toHaveBeenCalled();
      expect(await f.ids()).toEqual(['scope-linked-fixture']);
      expect(await f.storage.listRemovedSourceIds()).toEqual([]);
      // Outer ownership is released only after the failed batch settles.
      await expect(memory.removeSource(sourceId, f.receipt)).resolves.toEqual({
        sourceDeleted: true,
        memoriesDeleted: 1,
      });
      await memory.close();
    } finally {
      f.close();
    }
  },
);
