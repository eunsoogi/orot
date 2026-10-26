/** Stores one namespace/key item per Rememori row and keeps its original creation time on updates. */
import type { PutOperation } from '@langchain/langgraph';
import { Memory, normalize } from 'rememori';
import type { Embedder } from 'rememori';
import type { AgentMemoryStorageAdapter } from '../types';
import { cloneJsonObject } from './filters';
import { indexedTexts } from './indexing';
import { findStoreRecord } from './queries';
import type { LangGraphStoreMetadata } from './types';

export type StoreMutation = <T>(operation: (engine: Memory) => Promise<T>) => Promise<T>;

export async function putStoreItem(
  storage: AgentMemoryStorageAdapter,
  embedder: Embedder,
  mutate: StoreMutation,
  operation: PutOperation,
): Promise<void> {
  const existing = await findStoreRecord(storage, operation.namespace, operation.key);
  if (operation.value === null) {
    if (existing) {
      await mutate(async (engine) => {
        if (!(await engine.forget(existing.id))) {
          throw new Error('The loaded Rememori index is stale; reopen the store before deleting.');
        }
      });
    }
    return;
  }
  const value = cloneJsonObject(operation.value);
  const texts = indexedTexts(value, operation.index);
  const indexed = texts.length > 0;
  const primaryText = texts[0] ?? JSON.stringify([operation.namespace, operation.key]);
  const fieldVectors = await embedAdditionalTexts(embedder, texts);
  const now = Date.now();
  const metadata: LangGraphStoreMetadata = {
    version: 1,
    key: operation.key,
    namespace: [...operation.namespace],
    value,
    updatedAt: now,
    indexed,
    indexPaths: operation.index === false ? false : operation.index ? [...operation.index] : ['$'],
    fieldVectors,
  };
  await mutate(async (engine) => {
    if (existing && !(await engine.forget(existing.id))) {
      throw new Error('The loaded Rememori index is stale; reopen the store before updating.');
    }
    const id = await engine.remember(primaryText, {
      createdAt: existing?.createdAt ?? now,
      importance: 1,
      tags: ['langgraph-store'],
      entities: [],
      meta: { langgraphStore: metadata },
    });
    if (!id) throw new Error('Rememori did not return a record identifier.');
  });
}

async function embedAdditionalTexts(embedder: Embedder, texts: string[]): Promise<number[][]> {
  if (texts.length < 2) return [];
  const vectors = await embedder.embed(texts);
  if (vectors.length !== texts.length)
    throw new Error('Rememori embedder returned an unexpected vector count.');
  const normalized = vectors.map((vector) => {
    if (vector.length === 0 || vector.some((part) => !Number.isFinite(part))) {
      throw new Error('Rememori embedder returned an invalid field vector.');
    }
    return normalize(vector);
  });
  if (normalized.some((vector) => vector.length !== normalized[0]!.length)) {
    throw new Error('Rememori embedder returned inconsistent field vector dimensions.');
  }
  return normalized.slice(1).map((vector) => Array.from(vector));
}
