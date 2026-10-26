/** Converts scoped Rememori rows to LangGraph items and implements filtered search and listing. */
import type { Item, ListNamespacesOperation, SearchOperation } from '@langchain/langgraph';
import { normalize } from 'rememori';
import type { Embedder, MemoryRecord } from 'rememori';
import type { AgentMemoryStorageAdapter } from '../types';
import { cloneJsonObject, matchesFilter } from './filters';
import { compareNamespaces, matchesPath } from './namespace';
import { metadataFromRecord } from './types';

type SearchItem = Item & { score?: number };

export async function findStoreRecord(
  storage: AgentMemoryStorageAdapter,
  namespace: readonly string[],
  key: string,
): Promise<MemoryRecord | null> {
  const matches = (await storage.listRecords()).filter((record) => {
    const metadata = metadataFromRecord(record);
    return (
      metadata?.key === key && JSON.stringify(metadata.namespace) === JSON.stringify(namespace)
    );
  });
  if (matches.length > 1)
    throw new Error('Multiple Rememori rows exist for one LangGraph namespace and key.');
  return matches[0] ?? null;
}

export function toStoreItem(record: MemoryRecord): Item {
  const metadata = metadataFromRecord(record);
  if (!metadata) throw new Error('Stored LangGraph metadata is missing.');
  return {
    key: metadata.key,
    namespace: [...metadata.namespace],
    value: cloneJsonObject(metadata.value),
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(metadata.updatedAt),
  };
}

export async function searchStore(
  storage: AgentMemoryStorageAdapter,
  embedder: Embedder,
  operation: SearchOperation,
): Promise<SearchItem[]> {
  const candidates = (await storage.listRecords()).flatMap((record) => {
    const metadata = metadataFromRecord(record);
    const matchesPrefix =
      metadata &&
      operation.namespacePrefix.every((part, index) => metadata.namespace[index] === part);
    if (!metadata || !matchesPrefix || !matchesFilter(metadata.value, operation.filter)) return [];
    return [{ record, metadata, item: toStoreItem(record) }];
  });
  if (!operation.query)
    return page(
      candidates.map(({ item }) => item),
      operation.limit ?? 10,
      operation.offset ?? 0,
    );

  const [queryVector] = await embedder.embed([operation.query]);
  if (
    !queryVector ||
    queryVector.length === 0 ||
    queryVector.some((part) => !Number.isFinite(part))
  ) {
    throw new Error('Rememori embedder returned an invalid query vector.');
  }
  const normalizedQuery = normalize(queryVector);
  const ranked: SearchItem[] = [];
  const unindexed: SearchItem[] = [];
  // Extra field vectors share the same durable row so Rememori remains the sole storage authority.
  for (const candidate of candidates) {
    if (!candidate.metadata.indexed) {
      unindexed.push(candidate.item);
      continue;
    }
    const vectors = [
      candidate.record.vector,
      ...candidate.metadata.fieldVectors.map((vector) => Float32Array.from(vector)),
    ];
    const score = Math.max(...vectors.map((vector) => cosine(normalizedQuery, vector)));
    ranked.push({ ...candidate.item, score });
  }
  ranked.sort((left, right) => (right.score ?? 0) - (left.score ?? 0) || compareItems(left, right));
  unindexed.sort(compareItems);
  return page([...ranked, ...unindexed], operation.limit ?? 10, operation.offset ?? 0);
}

export async function listStoreNamespaces(
  storage: AgentMemoryStorageAdapter,
  operation: ListNamespacesOperation,
): Promise<string[][]> {
  const namespaces = new Map<string, string[]>();
  for (const record of await storage.listRecords()) {
    const metadata = metadataFromRecord(record);
    if (!metadata) continue;
    if (
      operation.matchConditions?.every((condition) =>
        matchesPath(metadata.namespace, condition.path, condition.matchType),
      ) === false
    )
      continue;
    const namespace =
      operation.maxDepth === undefined
        ? [...metadata.namespace]
        : metadata.namespace.slice(0, operation.maxDepth);
    namespaces.set(JSON.stringify(namespace), namespace);
  }
  return page([...namespaces.values()].sort(compareNamespaces), operation.limit, operation.offset);
}

function cosine(left: Float32Array, right: Float32Array): number {
  if (left.length !== right.length) throw new Error('Rememori embedding dimensions do not match.');
  const magnitude = Math.sqrt(right.reduce((sum, part) => sum + part * part, 0));
  return magnitude === 0
    ? 0
    : right.reduce((sum, part, index) => sum + part * left[index]!, 0) / magnitude;
}

function compareItems(left: Item, right: Item): number {
  return compareNamespaces(left.namespace, right.namespace) || left.key.localeCompare(right.key);
}

function page<T>(items: T[], limit: number, offset: number): T[] {
  return items.slice(offset, offset + limit);
}
