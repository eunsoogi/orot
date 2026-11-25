import {
  descendantId,
  fixture,
  row,
  sourceId,
} from '../testSupport/agentMemoryCascadeFixture';

test.each([true, false])(
  'matches durable source and descendant cleanup on old/new storage capability (%s legacy)',
  async legacy => {
    const f = await fixture(legacy);
    const linkedIds = Array.from(
      { length: 12 },
      (_, index) => `linked-${index}`,
    );
    try {
      for (const id of linkedIds) await f.seed(row(id, descendantId));
      await f.seed(row('same-owner-survivor', 'unrelated'));
      await f.seed(row('foreign-no-link', 'unrelated', ['owner-b']));
      await f.seed(row('foreign-linked', sourceId, ['owner-b']));
      // The existing durable source cascade also invalidates a reference to a removed
      // Memory ID, noting that only the chosen namespace owns the counted Memory rows.
      await f.seed(row('transitive-citation', linkedIds[0]!, ['owner-b']));
      const memory = await f.openMemory();
      const scans = jest.spyOn(f.storage, 'listRecords');

      await expect(
        memory.removeSource(
          sourceId,
          f.receipt,
          [descendantId],
          [
            { id: sourceId, kind: 'source_record' },
            { id: descendantId, kind: 'transcript_segment' },
          ],
        ),
      ).resolves.toEqual({ sourceDeleted: true, memoriesDeleted: 12 });
      expect(scans).toHaveBeenCalledTimes(legacy ? 13 : 1);
      expect(await f.ids()).toEqual(['foreign-no-link', 'same-owner-survivor']);
      const [again, concurrent] = await Promise.all([
        memory.removeSource(sourceId, f.receipt, [descendantId]),
        memory.removeSource(sourceId, f.receipt, [descendantId]),
      ]);
      expect([again.memoriesDeleted, concurrent.memoriesDeleted]).toEqual([
        0, 0,
      ]);
      expect(f.receipt).toHaveBeenCalledTimes(3);
      await memory.close();
    } finally {
      f.close();
    }
  },
);

test.each([true, false])(
  'a visible same-owner correction no longer receives a stale fence or hidden recall (%s legacy)',
  async legacy => {
    const f = await fixture(legacy);
    try {
      await f.seed(row('replaced', sourceId));
      await f.seed(row('revoked', sourceId));
      await f.seed(row('quarantined', sourceId));
      await f.seed(row('linked', sourceId));
      const memory = await f.openMemory();
      const mutate = async () => {
        await f.seed(row('replaced', 'new-review'));
        await f.seed(row('revoked', 'separate-review', ['owner-b']));
        await f.seed(row('quarantined', 'independently-revoked-parent'));
        await f.database.execute(
          'CREATE TABLE IF NOT EXISTS memory_parent_quarantine(memory_id TEXT NOT NULL, revision TEXT NOT NULL, PRIMARY KEY(memory_id,revision))',
        );
        await f.database.execute(
          'INSERT OR IGNORE INTO memory_parent_quarantine VALUES (?,?)',
          ['quarantined', 'fixture-revoked'],
        );
      };
      if (legacy) {
        const listRecords = f.storage.listRecords.bind(f.storage);
        jest
          .spyOn(f.storage, 'listRecords')
          .mockImplementationOnce(listRecords)
          .mockImplementationOnce(async () => {
            await mutate();
            return listRecords();
          });
      } else {
        const apply = f.storage.commitSourceCascade.bind(f.storage);
        jest
          .spyOn(f.storage, 'commitSourceCascade')
          .mockImplementationOnce(async (...intent) => {
            await mutate();
            return apply(...intent);
          });
      }
      await expect(memory.removeSource(sourceId, f.receipt)).resolves.toEqual({
        sourceDeleted: true,
        memoriesDeleted: legacy ? 4 : 1,
      });
      expect(await f.ids()).toEqual(
        legacy
          ? ['quarantined', 'revoked']
          : ['quarantined', 'replaced', 'revoked'],
      );
      const fences = await f.storage.listRemovedSourceIds();
      expect(fences).toContain('linked');
      expect(fences.includes('replaced')).toBe(legacy);
      expect(fences.includes('revoked')).toBe(legacy);
      expect(fences.includes('quarantined')).toBe(legacy);
      const hits = await memory.recall('synthetic memory');
      expect(hits.map(hit => hit.id)).toEqual(legacy ? [] : ['replaced']);
      const foreign = await f.openMemory(['owner-b']);
      expect(
        (await foreign.recall('synthetic memory')).map(hit => hit.id),
      ).toEqual(legacy ? [] : ['revoked']);
      await foreign.close();
      await memory.close();
    } finally {
      f.close();
    }
  },
);

test('a failed fence insert rolls back deletion and permits the same owning request to retry', async () => {
  const f = await fixture();
  try {
    await f.seed(row('linked', sourceId));
    await f.seed(row('kept', 'separate-review'));
    const memory = await f.openMemory();
    await f.database.execute(
      "CREATE TRIGGER fixture_fail_memory_cascade BEFORE INSERT ON agent_memory_removed_sources BEGIN SELECT RAISE(ABORT,'fixture fence failure'); END",
    );
    await expect(memory.removeSource(sourceId, f.receipt)).rejects.toThrow(
      'fixture fence failure',
    );
    expect(f.receipt).not.toHaveBeenCalled();
    expect(await f.ids()).toEqual(['kept', 'linked']);
    expect(await f.storage.listRemovedSourceIds()).toEqual([]);
    await f.database.execute('DROP TRIGGER fixture_fail_memory_cascade');
    await expect(memory.removeSource(sourceId, f.receipt)).resolves.toEqual({
      sourceDeleted: true,
      memoriesDeleted: 1,
    });
    expect(f.receipt).toHaveBeenCalledTimes(1);
    expect(await f.ids()).toEqual(['kept']);
    await memory.close();
  } finally {
    f.close();
  }
});
