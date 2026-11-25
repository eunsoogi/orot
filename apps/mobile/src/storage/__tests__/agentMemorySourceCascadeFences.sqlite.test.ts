import {
  descendantId,
  fixture,
  row,
  sourceId,
} from '../testSupport/agentMemoryCascadeFixture';

test.each([true, false])(
  'coupled Memory ID alias and typed descendant fences commit before source deletion (%s legacy)',
  async legacy => {
    const f = await fixture(legacy);
    try {
      await f.seed(row(sourceId, sourceId));
      await f.seed(row('foreign-kept', 'unrelated', ['owner-b']));
      const memory = await f.openMemory();
      const removeSource = jest.fn(async () => {
        expect(await f.ids()).toEqual(['foreign-kept']);
        expect(
          (
            await f.database.execute(
              "SELECT source_id, kind FROM typed_deletion_markers WHERE marker_table='agent_memory_removed_sources' ORDER BY source_id, kind",
            )
          ).rows,
        ).toEqual([
          { source_id: sourceId, kind: '*' },
          { source_id: descendantId, kind: 'transcript_family' },
          { source_id: descendantId, kind: 'transcript_segment' },
        ]);
        return true;
      });
      await expect(
        memory.removeSource(
          sourceId,
          removeSource,
          [descendantId],
          [
            { id: sourceId, kind: 'source_record' },
            { id: descendantId, kind: 'transcript_segment' },
            { id: descendantId, kind: 'transcript_family' },
            { id: descendantId, kind: 'transcript_segment' },
          ],
        ),
      ).resolves.toEqual({ sourceDeleted: true, memoriesDeleted: 1 });
      expect(removeSource).toHaveBeenCalledTimes(1);
      await memory.close();
    } finally {
      f.close();
    }
  },
);

test('ordinary Memory actions cannot opt in and an invalid native owner is rejected', async () => {
  const f = await fixture();
  try {
    await f.seed(row('ordinary', sourceId));
    const memory = await f.openMemory();
    const native = jest.spyOn(f.storage, 'commitSourceCascade');
    await expect(memory.forget('ordinary')).resolves.toBe(true);
    expect(native).not.toHaveBeenCalled();

    await f.seed(row('kept', sourceId));
    const intent = {
      references: new Set([sourceId]),
      candidateIds: ['kept'],
    };
    await expect(f.storage.commitSourceCascade(intent)).rejects.toThrow(
      'owner and references',
    );
    await expect(
      f.storage.commitSourceCascade(intent, '{"owner":"owner-a"}'),
    ).rejects.toThrow('owner and references');
    expect(await f.ids()).toEqual(['kept']);
    expect(await f.storage.listRemovedSourceIds()).toEqual([]);
    await memory.close();
  } finally {
    f.close();
  }
});

test('mutating the submitted intent after admission cannot widen the transaction', async () => {
  const f = await fixture();
  try {
    const separateId = 'fixture-separate-source';
    await f.seed(row('to-delete', sourceId));
    await f.seed(row('unrelated', separateId));
    const references = new Set([sourceId]);
    const candidateIds = ['to-delete'];
    const input = { references, candidateIds };
    const original = f.database.transaction.bind(f.database);
    jest.spyOn(f.database, 'transaction').mockImplementationOnce(operation => {
      references.add(separateId);
      candidateIds.push('unrelated');
      return original(operation);
    });
    await expect(
      f.storage.commitSourceCascade(input, '["owner-a"]'),
    ).resolves.toEqual(['to-delete']);
    expect(await f.ids()).toEqual(['unrelated']);
    expect(await f.storage.listRemovedSourceIds()).not.toContain(separateId);
  } finally {
    f.close();
  }
});
