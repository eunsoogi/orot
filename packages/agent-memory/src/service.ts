import type { Embedder, RecallOptions } from 'rememori';
import type { AgentMemoryHit, AgentMemoryInput, AgentMemoryStorageAdapter } from './types';
import { LocalAgentMemory } from './localAgentMemory';
import { namespacedStorage } from './namespacedStorage';

export interface CreateAgentMemoryOptions {
  readonly embedder: Embedder;
  readonly storage: AgentMemoryStorageAdapter;
  /** Trusted application scope. Omission selects existing, unnamespaced records. */
  readonly namespace?: readonly string[];
}

export interface AgentMemorySourceRemovalResult {
  readonly sourceDeleted: boolean;
  readonly memoriesDeleted: number;
}

export interface AgentMemoryService {
  /** Reads the current durable mapping without relying on a prior process's Rememori ID. */
  getByKey(memoryKey: string): Promise<Omit<AgentMemoryHit, 'score'> | null>;
  forgetByKey(memoryKey: string): Promise<boolean>;
  remember(input: AgentMemoryInput): Promise<string>;
  update(input: AgentMemoryInput): Promise<string>;
  recall(
    query: string,
    options?: Pick<RecallOptions, 'limit' | 'tags' | 'minSimilarity'>,
  ): Promise<AgentMemoryHit[]>;
  forget(memoryId: string): Promise<boolean>;
  forgetBySourceId(sourceId: string): Promise<number>;
  /** Forgets every memory and fences local-record plus memory-row IDs against stale references. */
  forgetAll(localRecordIds?: readonly string[]): Promise<number>;
  /** Removes source-linked memories and dependent-reference memories before the source callback runs. */
  removeSource(
    sourceId: string,
    deleteSourceRecord: () => Promise<boolean>,
    dependentReferenceIds?: readonly string[],
  ): Promise<AgentMemorySourceRemovalResult>;
  close(): Promise<void>;
}

export async function createAgentMemory(
  options: CreateAgentMemoryOptions,
): Promise<AgentMemoryService> {
  const service = new LocalAgentMemory(
    options.embedder,
    namespacedStorage(options.storage, options.namespace),
  );
  await service.open();
  return service;
}
