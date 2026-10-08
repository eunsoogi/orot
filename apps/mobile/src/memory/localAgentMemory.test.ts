import type { AgentMemoryService, EmbeddingProvider } from '@orot/agent-memory';
import { createAgentMemory, createRememoriEmbedder } from '@orot/agent-memory';
import { openLocalAgentMemoryDatabase } from '../storage/secureDatabase';
import {
  closeLocalAgentMemory,
  openLocalAgentMemory,
  openOrReuseLocalAgentMemory,
} from './localAgentMemory';

jest.mock('@orot/agent-memory', () => ({
  createAgentMemory: jest.fn(),
  createRememoriEmbedder: jest.fn(),
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
