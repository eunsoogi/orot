import type { AgentMemoryService, EmbeddingProvider } from '@orot/agent-memory';
import { createAgentMemory, createRememoriEmbedder } from '@orot/agent-memory';
import { SqlCipherAgentMemoryStorage } from '../storage/agentMemoryStorage';
import { openLocalAgentMemoryDatabase } from '../storage/secureDatabase';

let active: { provider: EmbeddingProvider; service: Promise<AgentMemoryService> } | null = null;
let closing: Promise<void> | null = null;

/** Opens one serialized memory service backed by the existing app SQLCipher database. */
export function openLocalAgentMemory(provider: EmbeddingProvider): Promise<AgentMemoryService> {
  if (closing) return closing.then(() => openLocalAgentMemory(provider));
  if (active) {
    if (active.provider !== provider) {
      return Promise.reject(new Error('Local agent memory is already open with another embedder.'));
    }
    return active.service;
  }
  const service = openLocalAgentMemoryDatabase()
    .then(database => createAgentMemory({
      embedder: createRememoriEmbedder(provider),
      storage: new SqlCipherAgentMemoryStorage(database),
    }))
    .catch(error => {
      active = null;
      throw error;
    });
  active = { provider, service };
  return service;
}

export async function closeLocalAgentMemory(): Promise<void> {
  if (closing) {
    await closing;
    return;
  }
  const current = active;
  if (!current) return;
  active = null;
  const operation = current.service.then(service => service.close());
  const settled = operation.then(() => undefined, () => undefined);
  closing = settled;
  try {
    await operation;
  } finally {
    if (closing === settled) closing = null;
  }
}
