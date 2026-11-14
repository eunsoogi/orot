import { coldResearchRegistryFixture as fixture } from '../testSupport/coldResearchRegistryFixture';
import { createColdResearchSourceReader } from '../coldResearchSourceReader';
import { restoreColdConversationRegistry } from '../restoreColdConversationRegistry';
import { captureConversationSources } from '../captureConversationSources';

test('reader is unusable before binding, binds once and refuses unknown or changed descriptors', async () => {
  const f = await fixture();
  try {
    const reader = createColdResearchSourceReader(f.input);
    await expect(reader.read(f.parent, f.input.signal)).resolves.toEqual({
      status: 'unavailable',
    });
    reader.bind(f.original);
    expect(() => reader.bind(f.original)).toThrow('already bound');
    expect((await reader.read(f.parent, f.input.signal)).status).toBe(
      'available',
    );
    await expect(
      reader.read({ ...f.parent, id: 'research-999' }, f.input.signal),
    ).resolves.toEqual({ status: 'unavailable' });
    await expect(
      reader.read({ ...f.parent, revision: 'different' }, f.input.signal),
    ).resolves.toEqual({ status: 'unavailable' });
    await expect(
      reader.read(
        {
          ...f.parent,
          reference: { ...f.parent.reference, evidenceRevision: 'different' },
        },
        f.input.signal,
      ),
    ).resolves.toEqual({ status: 'unavailable' });
  } finally {
    f.db.close();
  }
});

test('capture of a restored research graph does not allocate aliases or lose dependency links', async () => {
  const f = await fixture();
  try {
    const registry = await restoreColdConversationRegistry(f.input);
    const before = registry.snapshot();
    const captured = await captureConversationSources(
      before.entries.map(row => row.alias),
      registry,
      f.input.signal,
    );
    expect(registry.snapshot()).toEqual(before);
    expect(captured.sources).toEqual(f.input.sources);
    expect(f.data.rag.search).not.toHaveBeenCalled();
  } finally {
    f.db.close();
  }
});

test('deleting a dependency during its read cannot return the earlier cached child document', async () => {
  const f = await fixture();
  try {
    const registry = await restoreColdConversationRegistry(f.input);
    const read = f.discovery.read.bind(f.discovery);
    let removed = false;
    jest.spyOn(f.discovery, 'read').mockImplementation(async (id, signal) => {
      const result = await read(id, signal);
      if (id === f.parent.id && !removed) {
        removed = true;
        await f.db.database.execute(
          'DELETE FROM research_artifacts WHERE id = ?',
          [1],
        );
      }
      return result;
    });
    expect(
      (await registry.readSource(f.childAlias, f.input.signal)).status,
    ).not.toBe('available');
    expect(removed).toBe(true);
  } finally {
    f.db.close();
  }
});

test('a dependency with matching reference but different descriptor is not silently accepted', async () => {
  const f = await fixture();
  try {
    const registry = await restoreColdConversationRegistry(f.input);
    const read = f.discovery.read.bind(f.discovery);
    jest.spyOn(f.discovery, 'read').mockImplementation(async (id, signal) => {
      const value = await read(id, signal);
      return value && id === f.child.id
        ? {
            ...value,
            content: {
              ...value.content,
              inputSources: [
                { ...f.parent, revision: 'different-descriptor-revision' },
              ],
            },
          }
        : value;
    });
    expect(
      (await registry.readSource(f.childAlias, f.input.signal)).status,
    ).not.toBe('available');
  } finally {
    f.db.close();
  }
});
