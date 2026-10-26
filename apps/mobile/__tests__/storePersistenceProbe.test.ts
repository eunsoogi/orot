// This is a source-contract check with an in-memory adapter, not native persistence evidence.
jest.mock('../src/memory/localAgentMemory', () => ({
  openLocalAgentMemory: jest.fn(),
  openLocalAgentMemoryStore: jest.fn(),
  closeLocalAgentMemory: jest.fn(),
}));
jest.mock('../src/storage/secureDatabase', () => ({
  openLocalStorage: jest.fn(),
  getCipherVersion: jest.fn(async () => 'test-only'),
  verifyWrongKeyRejected: jest.fn(async () => true),
}));
jest.mock('../src/agent/localRecordQuery', () => ({
  openLocalRecordQueryService: jest.fn(),
}));
jest.mock('../src/memory/agentMemoryProbe', () => ({
  runAgentMemoryProbe: jest.fn(),
}));

import {
  createAgentMemory,
  createAgentMemoryStoreView,
  createRememoriEmbedder,
  RememoriLangGraphStore,
} from '@orot/agent-memory';
import { PersistentMemoryStorage } from '../../../packages/agent-memory/__tests__/testFixtures';
import {
  openLocalAgentMemory,
  openLocalAgentMemoryStore,
  closeLocalAgentMemory,
} from '../src/memory/localAgentMemory';
import { openLocalStorage } from '../src/storage/secureDatabase';
import { openLocalRecordQueryService } from '../src/agent/localRecordQuery';
import { runAgentMemoryProbe } from '../src/memory/agentMemoryProbe';
import {
  deterministicProvider,
  correctedText,
  createAgentMemoryProbeFixture,
} from '../src/memory/agentMemoryProbeFixtures';
import { runStorePersistenceOperation } from '../e2e/storePersistenceProbe';
import {
  assertIsolation,
  assertAbsent,
} from '../e2e/storePersistenceAssertions';

test('three native driver phases traverse the production graph and reject stale citations using the shared Store', async () => {
  const identifier = 'test-memory-12345678-1234-1234-1234-123456789012';
  const fixture = createAgentMemoryProbeFixture(identifier);
  const adapter = new PersistentMemoryStorage();
  const embedder = createRememoriEmbedder(deterministicProvider);
  let memory: Awaited<ReturnType<typeof createAgentMemory>> | null = null;
  let store: ReturnType<typeof createAgentMemoryStoreView> | null = null;
  const openMemory = async () => {
    memory ??= await createAgentMemory({ storage: adapter, embedder });
    return memory;
  };
  (openLocalAgentMemory as jest.Mock).mockImplementation(openMemory);
  (openLocalAgentMemoryStore as jest.Mock).mockImplementation(async () => {
    store ??= createAgentMemoryStoreView(
      await openMemory(),
      new RememoriLangGraphStore({ storage: adapter, embedder }),
    );
    return store;
  });
  (closeLocalAgentMemory as jest.Mock).mockImplementation(async () => {
    await store?.stop();
    await memory?.close();
    memory = null;
    store = null;
  });
  const appointments = new Map();
  (openLocalStorage as jest.Mock).mockResolvedValue({
    put: async (_kind: string, value: { id: string }) => {
      appointments.set(value.id, value);
    },
    delete: async (_kind: string, id: string) => appointments.delete(id),
  });
  (openLocalRecordQueryService as jest.Mock).mockImplementation(
    async reader => ({
      queryNextConfirmedCalendarAppointment: async () => ({
        status: 'available',
        appointment: [...appointments.values()][0] ?? null,
      }),
      searchMemory: async (query: string, limit: number) => ({
        status: 'available',
        hits: await reader.recall(query, { limit }),
        limit,
      }),
    }),
  );
  (runAgentMemoryProbe as jest.Mock).mockImplementation(async phase => {
    const service = await openMemory();
    if (phase === 'fresh')
      await service.remember({ ...fixture.memoryInput, text: correctedText });
    else if (phase === 'restart')
      await service.removeSource(identifier, async () => true);
    else
      expect(await service.getByKey(fixture.memoryInput.memoryKey)).toBeNull();
    await closeLocalAgentMemory();
  });
  const seed = await runStorePersistenceOperation('memory-create', identifier);
  const resume = await runStorePersistenceOperation(
    'memory-restart',
    identifier,
  );
  const absence = await runStorePersistenceOperation(
    'memory-verify-deletion',
    identifier,
  );
  for (const result of [seed, resume, absence]) {
    expect(result.storeReceipt).toMatchObject({
      fixtureIdentifier: identifier,
      memoryId: seed.storeReceipt.memoryId,
      createdAt: seed.storeReceipt.createdAt,
      updatedAt: seed.storeReceipt.updatedAt,
      networkAttempts: 0,
    });
    expect(result.storeReceipt.graphSearches).toBeGreaterThan(0);
  }
  expect(appointments.size).toBe(0);
  expect(await adapter.listRecords()).toEqual([]);
});

test('rejects unsupported phases before opening memory', async () => {
  await expect(
    runStorePersistenceOperation(
      'memory-delete',
      'test-memory-12345678-1234-1234-1234-123456789012',
    ),
  ).rejects.toThrow('Unsupported');
});

test('native isolation assertions reject a search that ignores namespace even when text filtering is correct', async () => {
  const storage = new PersistentMemoryStorage();
  const embedder = createRememoriEmbedder(deterministicProvider);
  const memory = await createAgentMemory({ storage, embedder });
  const store = createAgentMemoryStoreView(
    memory,
    new RememoriLangGraphStore({ storage, embedder }),
  );
  const namespace = ['native-store-persistence', 'local'];
  try {
    await store.put(namespace, 'profile', { text: correctedText }, ['text']);
    await store.put(
      ['native-store-persistence', 'foreign'],
      'profile',
      { text: correctedText },
      ['text'],
    );
    await expect(
      assertIsolation(store, namespace, 'ordinary-memory-key'),
    ).resolves.toBeUndefined();
    const search = store.search.bind(store);
    // Deliberately broken namespace handling retains the real Store's text filter.
    store.search = (_namespace, options) => search([], options);
    await expect(
      assertIsolation(store, namespace, 'ordinary-memory-key'),
    ).rejects.toThrow('namespace/search isolation failed');
  } finally {
    await store.stop();
    await memory.close();
  }
});

test('native absence assertions reject stale search results containing the last updated profile', async () => {
  const storage = new PersistentMemoryStorage();
  const embedder = createRememoriEmbedder(deterministicProvider);
  const memory = await createAgentMemory({ storage, embedder });
  const store = createAgentMemoryStoreView(
    memory,
    new RememoriLangGraphStore({ storage, embedder }),
  );
  const namespace = ['native-store-persistence', 'local'];
  try {
    await store.put(namespace, 'profile', { text: '수정된 외래 알림 기억' }, [
      'text',
    ]);
    const stale = await store.search(namespace, { query: correctedText });
    await store.delete(namespace, 'profile');
    await expect(
      assertAbsent(store, namespace, ['foreign'], 'ordinary-memory-key'),
    ).resolves.toBeUndefined();
    // Simulate an index retaining the updated row after key deletion, with functioning text filters.
    store.search = async (_namespace, options) =>
      stale.filter(
        item =>
          !options?.filter?.text || item.value.text === options.filter.text,
      );
    await expect(
      assertAbsent(store, namespace, ['foreign'], 'ordinary-memory-key'),
    ).rejects.toThrow('deleted Store search returned');
  } finally {
    await store.stop();
    await memory.close();
  }
});
