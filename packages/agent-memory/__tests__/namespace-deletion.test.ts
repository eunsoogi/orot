import { createAgentMemory } from '../src/service';
import { embedder, PersistentMemoryStorage, preference } from './testFixtures';

const unlinked = {
  ...preference,
  memoryKey: 'reviewed:unlinked',
  provenance: { sourceIds: [], reviewState: 'user_confirmed' as const },
};

describe('global erasure across namespace views', () => {
  it('erases linked and unlinked rows in every namespace and invalidates open views', async () => {
    const storage = new PersistentMemoryStorage();
    const scoped = await createAgentMemory({ embedder, storage, namespace: ['reviewed'] });
    const scopedUnlinkedId = await scoped.remember(unlinked);
    const scopedLinkedId = await scoped.remember(preference);
    await expect(scoped.recall(unlinked.text)).resolves.toHaveLength(2);
    const global = await createAgentMemory({ embedder, storage });
    const defaultLinkedId = await global.remember(preference);
    const defaultUnlinkedId = await global.remember(unlinked);

    await expect(global.forgetAll(['additional-local-record'])).resolves.toBe(4);
    expect(await storage.listRecords()).toEqual([]);
    expect(new Set(await storage.listRemovedSourceIds())).toEqual(
      new Set([
        scopedUnlinkedId,
        scopedLinkedId,
        defaultLinkedId,
        defaultUnlinkedId,
        ...preference.provenance.sourceIds,
        'additional-local-record',
      ]),
    );
    await expect(scoped.getByKey(unlinked.memoryKey)).resolves.toBeNull();
    await expect(scoped.recall(unlinked.text)).resolves.toEqual([]);
    await expect(global.recall(unlinked.text)).resolves.toEqual([]);
    // An already-open writer must not resurrect a deleted row as provenance.
    await expect(
      scoped.remember({
        ...unlinked,
        provenance: { ...unlinked.provenance, sourceIds: [scopedUnlinkedId] },
      }),
    ).rejects.toThrow('already removed');
    await scoped.close();
    await global.close();

    for (const namespace of [[], ['reviewed']]) {
      const reopened = await createAgentMemory({ embedder, storage, namespace });
      await expect(reopened.recall(unlinked.text)).resolves.toEqual([]);
      await expect(reopened.remember(preference)).rejects.toThrow('already removed');
      await reopened.close();
    }
  });

  it('rolls back global row deletion and fences when the shared batch fails', async () => {
    const storage = new PersistentMemoryStorage();
    const scoped = await createAgentMemory({ embedder, storage, namespace: ['reviewed'] });
    const scopedId = await scoped.remember(unlinked);
    const global = await createAgentMemory({ embedder, storage });
    const defaultId = await global.remember(preference);
    storage.failNextCommit = true;
    await expect(global.forgetAll()).rejects.toThrow('transaction');
    expect(await storage.listRecords()).toHaveLength(2);
    expect(await storage.listRemovedSourceIds()).toEqual([]);
    await expect(scoped.getByKey(unlinked.memoryKey)).resolves.toMatchObject({ id: scopedId });
    await expect(global.getByKey(preference.memoryKey)).resolves.toMatchObject({ id: defaultId });
    await scoped.close();
    await global.close();
    const reopened = await createAgentMemory({ embedder, storage, namespace: ['reviewed'] });
    await expect(reopened.recall(unlinked.text)).resolves.toMatchObject([{ id: scopedId }]);
    await reopened.close();
  });
});
