import type {
  GetOperation,
  ListNamespacesOperation,
  Operation,
  OperationResults,
} from '@langchain/langgraph';
import { Memory } from 'rememori';
import { namespacedStorage } from '../namespacedStorage';
import type { AgentMemoryStorageAdapter } from '../types';
import type { RememoriLangGraphStoreOptions } from './types';
import { LANGGRAPH_STORE_SCOPE } from './types';
import { findStoreRecord, listStoreNamespaces, searchStore, toStoreItem } from './queries';
import { validateOperation } from './validation';
import { putStoreItem } from './writes';

/** Serializes LangGraph calls over Rememori and keeps the injected storage caller-owned. */
export class RememoriLangGraphBackend {
  private engine: Memory | null = null;
  private tail: Promise<void> = Promise.resolve();
  private stopped = false;
  private readonly scopedStorage: AgentMemoryStorageAdapter;
  private readonly memoryStorage: AgentMemoryStorageAdapter;

  constructor(private readonly options: RememoriLangGraphStoreOptions) {
    this.scopedStorage = namespacedStorage(options.storage, LANGGRAPH_STORE_SCOPE);
    // Memory.close must not close an adapter that may also serve the agent-memory service.
    this.memoryStorage = { ...this.scopedStorage, close: async () => {} };
  }

  batch<Op extends Operation[]>(operations: Op): Promise<OperationResults<Op>> {
    return this.enqueue(async () => {
      operations.forEach(validateOperation);
      const results: unknown[] = [];
      // Each put/delete commits independently; later failures do not roll back earlier operations.
      for (const operation of operations) results.push(await this.execute(operation));
      return results as OperationResults<Op>;
    });
  }

  start(): Promise<void> {
    return this.enqueue(async () => {
      await this.getEngine();
    });
  }

  stop(): Promise<void> {
    return this.enqueue(async () => {
      if (this.stopped) return;
      this.stopped = true;
      if (this.engine) await this.engine.close();
      this.engine = null;
    }, true);
  }

  private enqueue<T>(operation: () => Promise<T>, allowStopped = false): Promise<T> {
    const result = this.tail.then(async () => {
      if (this.stopped && !allowStopped)
        throw new Error('LangGraph store is stopped. Create a new store to resume.');
      return operation();
    });
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async execute(operation: Operation): Promise<unknown> {
    if ('namespacePrefix' in operation)
      return searchStore(this.scopedStorage, this.options.embedder, operation);
    if ('value' in operation)
      return putStoreItem(this.scopedStorage, this.options.embedder, this.mutate, operation);
    if ('namespace' in operation && 'key' in operation) {
      const getOperation = operation as GetOperation;
      const record = await findStoreRecord(
        this.scopedStorage,
        getOperation.namespace,
        getOperation.key,
      );
      return record ? toStoreItem(record) : null;
    }
    return listStoreNamespaces(this.scopedStorage, operation as ListNamespacesOperation);
  }

  private mutate = async <T>(operation: (engine: Memory) => Promise<T>): Promise<T> => {
    this.scopedStorage.beginBatch();
    try {
      const result = await operation(await this.getEngine());
      await this.scopedStorage.commitBatch();
      return result;
    } catch (error) {
      this.scopedStorage.rollbackBatch();
      // Reopen from durable rows on the next operation after a failed mutation.
      this.engine = null;
      throw error;
    }
  };

  private async getEngine(): Promise<Memory> {
    if (!this.engine) {
      this.engine = await Memory.open(':memory:', {
        embedder: this.options.embedder,
        storage: this.memoryStorage,
        extractor: false,
        index: 'flat',
      });
    }
    return this.engine;
  }
}
