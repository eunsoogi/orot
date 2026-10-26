import type {
  AgentMemoryService,
  AgentMemoryStoreView,
  EmbeddingProvider,
} from '@orot/agent-memory';
import {
  createAgentMemory,
  createAgentMemoryStoreView,
  createRememoriEmbedder,
  RememoriLangGraphStore,
} from '@orot/agent-memory';
import { SqlCipherAgentMemoryStorage } from '../storage/agentMemoryStorage';
import { openLocalAgentMemoryDatabase } from '../storage/secureDatabase';

interface LocalAgentMemoryResources {
  readonly embedder: ReturnType<typeof createRememoriEmbedder>;
  readonly storage: SqlCipherAgentMemoryStorage;
}

let active: {
  provider: EmbeddingProvider;
  resources: Promise<LocalAgentMemoryResources>;
  service: Promise<AgentMemoryService>;
  store: Promise<AgentMemoryStoreView> | null;
} | null = null;
let closing: Promise<void> | null = null;

function openOrCreateLocalAgentMemory(provider: EmbeddingProvider) {
  if (active) {
    if (active.provider !== provider) {
      throw new Error(
        'Local agent memory is already open with another embedder.',
      );
    }
    return active;
  }
  const resources = openLocalAgentMemoryDatabase().then(database => ({
    embedder: createRememoriEmbedder(provider),
    storage: new SqlCipherAgentMemoryStorage(database),
  }));
  const service = resources
    .then(({ embedder, storage }) => createAgentMemory({ embedder, storage }))
    .catch(error => {
      if (active?.service === service) active = null;
      throw error;
    });
  active = { provider, resources, service, store: null };
  return active;
}

/** Opens the app memory service over the same SQLCipher database used by graph Store access. */
export function openLocalAgentMemory(
  provider: EmbeddingProvider,
): Promise<AgentMemoryService> {
  if (closing) return closing.then(() => openLocalAgentMemory(provider));
  try {
    return openOrCreateLocalAgentMemory(provider).service;
  } catch (error) {
    return Promise.reject(error);
  }
}

/** Builds one graph Store view over existing memory rows and Rememori Store rows. */
export function openLocalAgentMemoryStore(
  provider: EmbeddingProvider,
): Promise<AgentMemoryStoreView> {
  if (closing) return closing.then(() => openLocalAgentMemoryStore(provider));
  let current: NonNullable<typeof active>;
  try {
    current = openOrCreateLocalAgentMemory(provider);
  } catch (error) {
    return Promise.reject(error);
  }
  current.store ??= Promise.all([current.resources, current.service]).then(
    ([{ embedder, storage }, memory]) =>
      createAgentMemoryStoreView(
        memory,
        new RememoriLangGraphStore({ embedder, storage }),
      ),
  );
  return current.store;
}

/** Reuses the active memory engine during source deletion so an equivalent new embedder cannot open a conflicting service. */
export function openOrReuseLocalAgentMemory(
  provider: EmbeddingProvider,
): Promise<AgentMemoryService> {
  if (active) return active.service;
  return openLocalAgentMemory(provider);
}

export async function closeLocalAgentMemory(): Promise<void> {
  if (closing) {
    await closing;
    return;
  }
  const current = active;
  if (!current) return;
  active = null;
  const operation = current.service.then(async service => {
    const store = await current.store?.catch(() => undefined);
    let storeError: unknown;
    try {
      await store?.stop();
    } catch (error) {
      storeError = error;
    }
    await service.close();
    if (storeError) throw storeError;
  });
  const settled = operation.then(
    () => undefined,
    () => undefined,
  );
  closing = settled;
  try {
    await operation;
  } finally {
    if (closing === settled) closing = null;
  }
}
