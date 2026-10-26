import { createAgentMemory } from '../src/service';
import { RememoriLangGraphStore } from '../src/langgraphStore/store';
import type { Embedder } from 'rememori';
import { PersistentMemoryStorage, preference } from './testFixtures';

const embedder: Embedder = {
  async embed(texts) {
    const terms = ['orchid', 'violet', 'silver', 'pine'];
    return texts.map((text) => {
      const normalized = text.toLowerCase();
      return Float32Array.from(terms.map((term) => (normalized.includes(term) ? 1 : 0)));
    });
  },
};

describe('Rememori-backed LangGraph store', () => {
  it('persists values, timestamps, and provenance across a new store instance', async () => {
    const storage = new PersistentMemoryStorage();
    const firstStore = new RememoriLangGraphStore({ storage, embedder });
    await firstStore.put(['users', '42'], 'profile', {
      topic: 'orchid',
      provenance: { sourceId: 'reviewed-record-1', reviewState: 'human_reviewed' },
    });
    const first = await firstStore.get(['users', '42'], 'profile');
    await firstStore.stop();

    const reopened = new RememoriLangGraphStore({ storage, embedder });
    const restored = await reopened.get(['users', '42'], 'profile');
    expect(restored?.value).toEqual(first?.value);
    expect(restored?.namespace).toEqual(['users', '42']);
    expect(restored?.createdAt).toEqual(first?.createdAt);
    expect(restored?.updatedAt).toEqual(first?.updatedAt);
    await reopened.put(['users', '42'], 'profile', {
      topic: 'violet',
      provenance: { sourceId: 'reviewed-record-2', reviewState: 'user_confirmed' },
    });
    const updated = await reopened.get(['users', '42'], 'profile');
    expect(updated?.createdAt).toEqual(first?.createdAt);
    expect(updated?.value.provenance).toEqual({
      sourceId: 'reviewed-record-2',
      reviewState: 'user_confirmed',
    });
    expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(first?.updatedAt.getTime() ?? 0);
    expect(await storage.listRecords()).toHaveLength(1);
    await reopened.stop();
  });

  it('isolates LangGraph rows from regular agent-memory records in the same durable adapter', async () => {
    const storage = new PersistentMemoryStorage();
    const memory = await createAgentMemory({ storage, embedder });
    const memoryId = await memory.remember(preference);
    const store = new RememoriLangGraphStore({ storage, embedder });
    await store.put(['users', '42'], 'profile', { topic: 'orchid' });

    expect(await store.get(['users', '42'], preference.memoryKey)).toBeNull();
    expect(await store.search([], { query: 'orchid' })).toMatchObject([{ key: 'profile' }]);
    expect(await memory.getByKey(preference.memoryKey)).toMatchObject({ id: memoryId });
    expect((await storage.listRecords()).map((record) => record.meta.namespace)).toEqual([
      [],
      ['langgraph-store'],
    ]);
    await store.stop();
    await memory.close();
  });

  it('matches namespace prefixes, filters and selected multi-field semantic indexes', async () => {
    const store = new RememoriLangGraphStore({ storage: new PersistentMemoryStorage(), embedder });
    await store.put(
      ['users', 'profile'],
      'one',
      { title: 'orchid', body: 'violet', status: 'open', rank: 3 },
      ['title', 'body'],
    );
    await store.put(['users2', 'profile'], 'two', { title: 'silver', status: 'closed', rank: 4 });
    await store.put(
      ['users', 'profile'],
      'three',
      { chapters: [{ text: 'pine' }, { text: 'silver' }] },
      ['chapters[*].text'],
    );

    const search = await store.search(['users'], {
      query: 'violet',
      filter: { status: 'open', rank: { $gte: 3 } },
    });
    expect(search).toHaveLength(1);
    expect(search[0]).toMatchObject({ key: 'one', score: 1, value: { body: 'violet' } });
    const arraySearch = await store.search(['users'], { query: 'pine' });
    expect(arraySearch[0]).toMatchObject({ key: 'three', score: 1 });
    await expect(store.search(['users'], { filter: { status: 'closed' } })).resolves.toEqual([]);
    await store.stop();
  });

  it('lists distinct namespaces with wildcard conditions and paginates in stable order', async () => {
    const store = new RememoriLangGraphStore({ storage: new PersistentMemoryStorage(), embedder });
    for (const namespace of [
      ['docs', 'a', 'v1'],
      ['docs', 'b', 'v1'],
      ['team', 'a', 'v1'],
    ] as const) {
      await store.put([...namespace], namespace[1]!, { topic: 'pine' }, false);
    }

    await expect(store.listNamespaces({ prefix: ['docs', '*'], suffix: ['v1'] })).resolves.toEqual([
      ['docs', 'a', 'v1'],
      ['docs', 'b', 'v1'],
    ]);
    await expect(store.listNamespaces({ prefix: ['docs'], limit: 1, offset: 1 })).resolves.toEqual([
      ['docs', 'b', 'v1'],
    ]);
    await expect(store.search(['docs'], { query: 'pine', limit: 1 })).resolves.toMatchObject([
      { key: 'a', value: { topic: 'pine' } },
    ]);
    await store.stop();
  });

  it('returns batch results in operation order and deletes only the requested key', async () => {
    const store = new RememoriLangGraphStore({ storage: new PersistentMemoryStorage(), embedder });
    const results = await store.batch([
      { namespace: ['batch'], key: 'first', value: { topic: 'orchid' } },
      { namespace: ['batch'], key: 'first' },
      { namespace: ['batch'], key: 'second', value: { topic: 'violet' } },
      { namespace: ['batch'], key: 'first', value: null },
      { namespace: ['batch'], key: 'first' },
      { namespace: ['batch'], key: 'second' },
    ]);

    expect(results[0]).toBeUndefined();
    expect(results[1]).toMatchObject({ key: 'first', value: { topic: 'orchid' } });
    expect(results[2]).toBeUndefined();
    expect(results[3]).toBeUndefined();
    expect(results[4]).toBeNull();
    expect(results[5]).toMatchObject({ key: 'second', value: { topic: 'violet' } });
    await store.stop();
  });

  it('rejects unsupported filter operators and non-JSON values before writing a batch', async () => {
    const store = new RememoriLangGraphStore({ storage: new PersistentMemoryStorage(), embedder });
    await expect(
      store.batch([
        { namespace: ['safe'], key: 'item', value: { text: 'orchid' } },
        { namespacePrefix: ['safe'], filter: { text: { $contains: 'orchid' } } },
      ]),
    ).rejects.toThrow('unsupported operator');
    await expect(store.put(['safe'], 'invalid', { value: Number.NaN })).rejects.toThrow(
      'JSON-compatible',
    );
    await expect(store.get(['safe'], 'item')).resolves.toBeNull();
    await store.stop();
  });
});
