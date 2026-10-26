/** Defines the private Rememori scope and row metadata needed to restore LangGraph items. */
import type { MemoryRecord, Embedder } from 'rememori';
import type { AgentMemoryStorageAdapter } from '../types';

export const LANGGRAPH_STORE_SCOPE = ['langgraph-store'] as const;

export interface RememoriLangGraphStoreOptions {
  readonly embedder: Embedder;
  readonly storage: AgentMemoryStorageAdapter;
}

export interface LangGraphStoreMetadata {
  readonly version: 1;
  readonly key: string;
  readonly namespace: string[];
  readonly value: Record<string, unknown>;
  readonly updatedAt: number;
  readonly indexed: boolean;
  readonly indexPaths: false | string[];
  /** Additional field vectors stay in the same Rememori row as its first vector. */
  readonly fieldVectors: number[][];
}

export function metadataFromRecord(record: MemoryRecord): LangGraphStoreMetadata | null {
  const metadata = record.meta.langgraphStore;
  if (metadata === undefined) return null;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error('Stored LangGraph metadata is invalid.');
  }
  const entry = metadata as Partial<LangGraphStoreMetadata>;
  if (
    entry.version !== 1 ||
    typeof entry.key !== 'string' ||
    !Array.isArray(entry.namespace) ||
    !entry.namespace.every((part) => typeof part === 'string') ||
    !entry.value ||
    typeof entry.value !== 'object' ||
    Array.isArray(entry.value) ||
    typeof entry.updatedAt !== 'number' ||
    !Number.isFinite(entry.updatedAt) ||
    typeof entry.indexed !== 'boolean' ||
    !(
      entry.indexPaths === false ||
      (Array.isArray(entry.indexPaths) &&
        entry.indexPaths.every((path) => typeof path === 'string'))
    ) ||
    !Array.isArray(entry.fieldVectors) ||
    !entry.fieldVectors.every(
      (vector) => Array.isArray(vector) && vector.every((part) => Number.isFinite(part)),
    )
  ) {
    throw new Error('Stored LangGraph metadata is invalid.');
  }
  return entry as LangGraphStoreMetadata;
}
