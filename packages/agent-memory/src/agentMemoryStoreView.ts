import { BaseStore } from '@langchain/langgraph/web';
import type { Item, Operation, OperationResults } from '@langchain/langgraph/web';
import type { AgentMemoryHit, AgentMemoryInput } from './types';
import type { AgentMemoryService } from './service';
import { matchesFilter } from './langgraphStore/filters';
import { validateOperation } from './langgraphStore/validation';

/** Existing default-scope Rememori rows exposed under a fixed graph-wide memory namespace. */
export const AGENT_MEMORY_NAMESPACE = ['agent-memory'] as const;

/** Internal command namespace keeps deletion bound to the authorized Rememori ID. */
export const AGENT_MEMORY_DELETE_BY_ID_NAMESPACE = ['agent-memory', 'delete-by-id'] as const;

/** Routes the legacy memory namespace to its existing service and all other namespaces to Store. */
export class AgentMemoryStoreView extends BaseStore {
  constructor(
    private readonly memory: AgentMemoryService,
    private readonly backingStore: BaseStore,
  ) {
    super();
  }

  async batch<Op extends Operation[]>(operations: Op): Promise<OperationResults<Op>> {
    const results: unknown[] = [];
    for (const operation of operations) {
      if (isAgentMemoryOperation(operation)) {
        results.push(await this.runMemoryOperation(operation));
      } else {
        const [result] = await this.backingStore.batch([operation]);
        results.push(result);
      }
    }
    return results as OperationResults<Op>;
  }

  async start(): Promise<void> {
    await this.backingStore.start?.();
  }

  async stop(): Promise<void> {
    await this.backingStore.stop?.();
  }

  private async runMemoryOperation(operation: Operation): Promise<unknown> {
    validateOperation(operation);
    if ('namespacePrefix' in operation) {
      if (!sameNamespace(operation.namespacePrefix)) return [];
      if (operation.filter && typeof operation.filter.id === 'string') {
        const hit = await this.memory.getById(operation.filter.id);
        if (!hit) return [];
        const item = toStoreItem(hit);
        return matchesFilter(item.value, operation.filter) ? [{ ...item, score: 0 }] : [];
      }
      if (!operation.query?.trim()) return [];
      const limit = operation.limit ?? 10;
      const offset = operation.offset ?? 0;
      if (limit === 0) return [];
      const hits = await this.memory.recall(operation.query, { limit: limit + offset });
      return hits
        .map(toStoreItem)
        .filter((item) => matchesFilter(item.value, operation.filter))
        .slice(offset, offset + limit);
    }
    if ('value' in operation) {
      if (operation.value === null) {
        if (sameNamespace(operation.namespace, AGENT_MEMORY_DELETE_BY_ID_NAMESPACE)) {
          await this.memory.forget(operation.key);
          return undefined;
        }
        if (!sameNamespace(operation.namespace)) {
          throw new Error('Existing agent-memory rows support only the fixed namespace.');
        }
        await this.memory.forgetByKey(operation.key);
        return undefined;
      }
      if (!sameNamespace(operation.namespace)) {
        throw new Error('Existing agent-memory rows support only the fixed namespace.');
      }
      const input = memoryInput(operation.key, operation.value);
      await this.memory.update(input);
      return undefined;
    }
    if ('namespace' in operation && 'key' in operation) {
      if (!sameNamespace(operation.namespace)) return null;
      const hit = await this.memory.getByKey(operation.key);
      return hit ? toStoreItem(hit) : null;
    }
    return [];
  }
}

/** The service and Store view share Rememori rows; this adds no copy or per-thread authority. */
export function createAgentMemoryStoreView(
  memory: AgentMemoryService,
  backingStore: BaseStore,
): AgentMemoryStoreView {
  return new AgentMemoryStoreView(memory, backingStore);
}

function isAgentMemoryOperation(operation: Operation): boolean {
  if ('namespace' in operation) return operation.namespace[0] === AGENT_MEMORY_NAMESPACE[0];
  return (
    'namespacePrefix' in operation && operation.namespacePrefix[0] === AGENT_MEMORY_NAMESPACE[0]
  );
}

function sameNamespace(
  namespace: readonly string[],
  expected: readonly string[] = AGENT_MEMORY_NAMESPACE,
): boolean {
  return (
    namespace.length === expected.length &&
    namespace.every((part, index) => part === expected[index])
  );
}

function memoryInput(key: string, value: Record<string, unknown>): AgentMemoryInput {
  if (value.memoryKey !== key) {
    throw new Error('Agent-memory Store keys must match the stable memory key.');
  }
  return value as unknown as AgentMemoryInput;
}

type MemoryStoreHit = Omit<AgentMemoryHit, 'score'> & { readonly score?: number };

function toStoreItem(hit: MemoryStoreHit): Item {
  if (!hit.memoryKey) throw new Error('Agent-memory Store row has no stable key.');
  const createdAt = new Date(hit.createdAt);
  return {
    key: hit.memoryKey,
    namespace: [...AGENT_MEMORY_NAMESPACE],
    value: {
      memoryKey: hit.memoryKey,
      id: hit.id,
      text: hit.text,
      kind: hit.kind,
      provenance: hit.provenance,
      createdAt: hit.createdAt,
      ...('score' in hit ? { score: hit.score } : {}),
    },
    createdAt,
    // The legacy schema has no updatedAt field, so preserve its creation time for both timestamps.
    updatedAt: createdAt,
    ...('score' in hit ? { score: hit.score } : {}),
  };
}
