import { Memory, type Embedder } from 'rememori';
import type { AgentMemoryStorageAdapter } from './types';

/** Rebuilds the in-memory index from the storage adapter's current visible records. */
export function openMemoryEngine(
  embedder: Embedder,
  storage: AgentMemoryStorageAdapter,
): Promise<Memory> {
  return Memory.open(':memory:', { embedder, storage, extractor: false, index: 'flat' });
}
