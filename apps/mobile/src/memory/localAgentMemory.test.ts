import type { AgentMemoryService, EmbeddingProvider } from '@orot/agent-memory';
import {
  createAgentMemory,
  createAgentMemoryStoreView,
  createRememoriEmbedder,
  RememoriLangGraphStore,
} from '@orot/agent-memory';
import { openLocalAgentMemoryDatabase } from '../storage/secureDatabase';
import {
  closeLocalAgentMemory,
  openLocalAgentMemory,
  openLocalAgentMemoryStore,
  openOrReuseLocalAgentMemory,
} from './localAgentMemory';

jest.mock('@orot/agent-memory', () => ({
  createAgentMemory: jest.fn(),
  createAgentMemoryStoreView: jest.fn(),
  createRememoriEmbedder: jest.fn(),
  RememoriLangGraphStore: jest.fn(),
}));
jest.mock('../storage/agentMemoryStorage', () => ({
  SqlCipherAgentMemoryStorage: jest.fn(),
}));
jest.mock('../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
}));

test('reuses the open memory service when deletion creates an equivalent embedder', async () => {
  const service = {
    close: jest.fn(async () => {}),
  } as unknown as AgentMemoryService;
  const firstProvider = { id: 'first' } as EmbeddingProvider;
  const deletionProvider = { id: 'deletion' } as EmbeddingProvider;
  jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue({} as never);
  jest.mocked(createRememoriEmbedder).mockReturnValue({} as never);
  jest.mocked(createAgentMemory).mockResolvedValue(service);

  const opened = openLocalAgentMemory(firstProvider);
  const reused = openOrReuseLocalAgentMemory(deletionProvider);

  expect(reused).toBe(opened);
  await expect(reused).resolves.toBe(service);
  expect(createAgentMemory).toHaveBeenCalledTimes(1);
  await closeLocalAgentMemory();
  expect(service.close).toHaveBeenCalledTimes(1);
});

test('shares the encrypted storage and embedder with the graph Store lifecycle', async () => {
  jest.clearAllMocks();
  const database = {};
  const service = {
    close: jest.fn(async () => {}),
  } as unknown as AgentMemoryService;
  const store = { stop: jest.fn(async () => {}) };
  const provider = { id: 'shared-provider' } as EmbeddingProvider;
  const embedder = {};
  jest
    .mocked(openLocalAgentMemoryDatabase)
    .mockResolvedValue(database as never);
  jest.mocked(createRememoriEmbedder).mockReturnValue(embedder as never);
  jest.mocked(createAgentMemory).mockResolvedValue(service);
  jest.mocked(createAgentMemoryStoreView).mockReturnValue(store as never);

  const openedMemory = openLocalAgentMemory(provider);
  const openedStore = openLocalAgentMemoryStore(provider);
  await expect(openedMemory).resolves.toBe(service);
  await expect(openedStore).resolves.toBe(store);

  expect(openLocalAgentMemoryDatabase).toHaveBeenCalledTimes(1);
  expect(RememoriLangGraphStore).toHaveBeenCalledTimes(1);
  const memoryOptions = jest.mocked(createAgentMemory).mock.calls[0]?.[0];
  const storeOptions = jest.mocked(RememoriLangGraphStore).mock.calls[0]?.[0];
  expect(storeOptions).toMatchObject({
    embedder,
    storage: memoryOptions?.storage,
  });

  await closeLocalAgentMemory();
  expect(store.stop).toHaveBeenCalledTimes(1);
  expect(service.close).toHaveBeenCalledTimes(1);
});
