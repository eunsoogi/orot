import { createAgentMemory } from '../src/service';
import { AGENT_MEMORY_NAMESPACE, createAgentMemoryStoreView } from '../src/agentMemoryStoreView';
import { RememoriLangGraphStore } from '../src/langgraphStore/store';
import { embedder, PersistentMemoryStorage, preference } from './testFixtures';

describe('the existing-row agent-memory Store view', () => {
  it('searches the same persistent Rememori rows after a service relaunch', async () => {
    const storage = new PersistentMemoryStorage();
    const firstMemory = await createAgentMemory({ embedder, storage });
    const memoryId = await firstMemory.remember(preference);
    const firstStore = createAgentMemoryStoreView(
      firstMemory,
      new RememoriLangGraphStore({ embedder, storage }),
    );

    await expect(
      firstStore.search(AGENT_MEMORY_NAMESPACE, {
        query: preference.text,
        limit: 2,
      }),
    ).resolves.toMatchObject([
      {
        key: preference.memoryKey,
        namespace: AGENT_MEMORY_NAMESPACE,
        value: {
          id: memoryId,
          memoryKey: preference.memoryKey,
          text: preference.text,
          kind: preference.kind,
          provenance: preference.provenance,
        },
      },
    ]);
    await firstStore.stop();
    await firstMemory.close();

    const nextMemory = await createAgentMemory({ embedder, storage });
    const nextStore = createAgentMemoryStoreView(
      nextMemory,
      new RememoriLangGraphStore({ embedder, storage }),
    );
    await expect(
      nextStore.search(AGENT_MEMORY_NAMESPACE, {
        query: preference.text,
        limit: 2,
      }),
    ).resolves.toMatchObject([{ value: { id: memoryId } }]);
    await nextStore.stop();
    await nextMemory.close();
  });

  it('keeps existing agent-memory rows separate from generic Store namespaces', async () => {
    const storage = new PersistentMemoryStorage();
    const memory = await createAgentMemory({ embedder, storage });
    await memory.remember(preference);
    const backingStore = new RememoriLangGraphStore({ embedder, storage });
    await backingStore.put(['private'], 'same-key', { text: 'Generic Store row' });
    const store = createAgentMemoryStoreView(memory, backingStore);

    await expect(store.get(['agent-memory'], 'same-key')).resolves.toBeNull();
    await expect(store.get(['private'], 'same-key')).resolves.toMatchObject({
      value: { text: 'Generic Store row' },
    });
    await expect(
      store.search(AGENT_MEMORY_NAMESPACE, {
        query: preference.text,
        limit: 2,
      }),
    ).resolves.toMatchObject([{ key: preference.memoryKey }]);
    await store.stop();
    await memory.close();
  });

  it('hides source-invalidated rows from Store search and exact ID lookup', async () => {
    const storage = new PersistentMemoryStorage();
    const memory = await createAgentMemory({ embedder, storage });
    const memoryId = await memory.remember(preference);
    const store = createAgentMemoryStoreView(
      memory,
      new RememoriLangGraphStore({ embedder, storage }),
    );

    await expect(
      store.search(AGENT_MEMORY_NAMESPACE, {
        query: preference.text,
        limit: 2,
      }),
    ).resolves.toMatchObject([{ value: { id: memoryId } }]);
    await expect(
      store.search(AGENT_MEMORY_NAMESPACE, {
        filter: { id: memoryId },
        limit: 1,
      }),
    ).resolves.toMatchObject([{ key: preference.memoryKey, value: { id: memoryId } }]);
    storage.invalidatedSourceIds.add(preference.provenance.sourceIds[0]!);

    await expect(
      store.search(AGENT_MEMORY_NAMESPACE, {
        query: preference.text,
        limit: 2,
      }),
    ).resolves.toEqual([]);
    await expect(
      store.search(AGENT_MEMORY_NAMESPACE, {
        filter: { id: memoryId },
        limit: 1,
      }),
    ).resolves.toEqual([]);
    await store.stop();
    await memory.close();
  });
});
