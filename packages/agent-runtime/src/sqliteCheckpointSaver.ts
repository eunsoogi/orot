import type { RunnableConfig } from '@langchain/core/runnables';
import { BaseCheckpointSaver, copyCheckpoint } from '@langchain/langgraph/web';
import type { Checkpoint, CheckpointTuple } from '@langchain/langgraph/web';

type CheckpointListOptions = NonNullable<Parameters<BaseCheckpointSaver<number>['list']>[1]>;
type CheckpointMetadata = Parameters<BaseCheckpointSaver<number>['put']>[2];
type ChannelVersions = Parameters<BaseCheckpointSaver<number>['put']>[3];
type PendingWrite = Parameters<BaseCheckpointSaver<number>['putWrites']>[1][number];

interface CheckpointRecord {
  checkpointId: string;
  parentCheckpointId: string | null;
  checkpointType: string;
  checkpoint: Uint8Array;
  metadataType: string;
  metadata: Uint8Array;
}

interface CheckpointBundle extends CheckpointRecord {
  threadId: string;
  namespace: string;
  pendingWrites: Array<{
    taskId: string;
    channel: string;
    type: string;
    value: Uint8Array;
  }>;
}

interface StoredWrite {
  taskId: string;
  index: number;
  channel: string;
  type: string;
  value: Uint8Array;
  replaceExisting: boolean;
}

interface CheckpointStorage {
  ensureSchema(): Promise<void>;
  saveCheckpoint(threadId: string, namespace: string, checkpoint: CheckpointRecord): Promise<void>;
  saveWrites(threadId: string, namespace: string, checkpointId: string, writes: StoredWrite[]): Promise<void>;
  loadCheckpoint(threadId: string, namespace: string, checkpointId?: string): Promise<CheckpointBundle | undefined>;
  listCheckpoints(
    threadId: string,
    namespace?: string,
    beforeCheckpointId?: string,
    limit?: number,
  ): Promise<CheckpointBundle[]>;
  deleteThread(threadId: string): Promise<void>;
}

// These are LangGraph's reserved write slots from WRITES_IDX_MAP.
const SPECIAL_WRITE_INDEX = new Map<string, number>([
  ['__error__', -1],
  ['__scheduled__', -2],
  ['__interrupt__', -3],
  ['__resume__', -4],
]);

export class SqliteCheckpointSaver extends BaseCheckpointSaver<number> {
  constructor(private readonly storage: CheckpointStorage) {
    super();
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = readThreadId(config);
    const namespace = readNamespace(config);
    const bundle = await this.storage.loadCheckpoint(
      threadId,
      namespace,
      readOptionalCheckpointId(config),
    );
    return bundle ? this.toTuple(bundle) : undefined;
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    const threadId = readThreadId(config);
    const namespace = readOptionalNamespace(config);
    const before = options?.before ? readOptionalCheckpointId(options.before) : undefined;
    const filter = options?.filter;
    const limit = options?.limit;
    if (limit !== undefined && limit <= 0) return;

    const bundles = await this.storage.listCheckpoints(
      threadId,
      namespace,
      before,
      filter ? undefined : limit,
    );
    let yielded = 0;
    for (const bundle of bundles) {
      const tuple = await this.toTuple(bundle);
      if (filter && !matchesFilter(tuple.metadata, filter)) continue;
      yield tuple;
      yielded += 1;
      if (limit !== undefined && yielded >= limit) return;
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: ChannelVersions,
  ): Promise<RunnableConfig> {
    const threadId = readThreadId(config);
    const namespace = readNamespace(config);
    const parentCheckpointId = readOptionalCheckpointId(config);
    const [[checkpointType, checkpointBytes], [metadataType, metadataBytes]] = await Promise.all([
      this.serde.dumpsTyped(copyCheckpoint(checkpoint)),
      this.serde.dumpsTyped(metadata),
    ]);
    await this.storage.saveCheckpoint(threadId, namespace, {
      checkpointId: checkpoint.id,
      parentCheckpointId: parentCheckpointId ?? null,
      checkpointType,
      checkpoint: checkpointBytes,
      metadataType,
      metadata: metadataBytes,
    });
    return {
      ...config,
      configurable: { ...config.configurable, thread_id: threadId, checkpoint_ns: namespace, checkpoint_id: checkpoint.id },
    };
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    const threadId = readThreadId(config);
    const namespace = readNamespace(config);
    const checkpointId = readOptionalCheckpointId(config);
    if (!checkpointId) throw new Error('Missing checkpoint_id in checkpoint write config.');

    const stored = await Promise.all(writes.map(async ([channel, value], index) => {
      const [type, serialized] = await this.serde.dumpsTyped(value);
      return {
        taskId,
        index: SPECIAL_WRITE_INDEX.get(channel) ?? index,
        channel,
        type,
        value: serialized,
        replaceExisting: SPECIAL_WRITE_INDEX.has(channel),
      };
    }));
    await this.storage.saveWrites(threadId, namespace, checkpointId, stored);
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.storage.ensureSchema();
    await this.storage.deleteThread(threadId);
  }

  private async toTuple(bundle: CheckpointBundle): Promise<CheckpointTuple> {
    const [checkpoint, metadata] = await Promise.all([
      this.serde.loadsTyped(bundle.checkpointType, bundle.checkpoint),
      this.serde.loadsTyped(bundle.metadataType, bundle.metadata),
    ]);
    const configurable = {
      thread_id: bundle.threadId,
      checkpoint_ns: bundle.namespace,
      checkpoint_id: bundle.checkpointId,
    };
    const pendingWrites = await Promise.all(bundle.pendingWrites.map(async write => [
      write.taskId,
      write.channel,
      await this.serde.loadsTyped(write.type, write.value),
    ] as [string, string, unknown]));
    return {
      config: { configurable },
      checkpoint: checkpoint as Checkpoint,
      metadata: metadata as CheckpointMetadata,
      parentConfig: bundle.parentCheckpointId
        ? { configurable: { ...configurable, checkpoint_id: bundle.parentCheckpointId } }
        : undefined,
      pendingWrites,
    };
  }
}

function readThreadId(config: RunnableConfig): string {
  const value = config.configurable?.thread_id;
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).length === 0) {
    throw new Error('Missing thread_id in checkpoint config.');
  }
  return String(value);
}

function readNamespace(config: RunnableConfig): string {
  const value = config.configurable?.checkpoint_ns;
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new Error('Invalid checkpoint_ns in checkpoint config.');
  return value;
}

function readOptionalNamespace(config: RunnableConfig): string | undefined {
  const value = config.configurable?.checkpoint_ns;
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error('Invalid checkpoint_ns in checkpoint config.');
  return value;
}

function readOptionalCheckpointId(config: RunnableConfig): string | undefined {
  const value = config.configurable?.checkpoint_id;
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error('Invalid checkpoint_id in checkpoint config.');
  return value;
}

function matchesFilter(metadata: CheckpointTuple['metadata'], filter: Record<string, unknown>): boolean {
  if (!metadata) return Object.keys(filter).length === 0;
  const values = metadata as Record<string, unknown>;
  return Object.entries(filter).every(([key, expected]) => valuesEqual(values[key], expected));
}

function valuesEqual(actual: unknown, expected: unknown): boolean {
  if (Object.is(actual, expected)) return true;
  if (actual === null || expected === null || typeof actual !== 'object' || typeof expected !== 'object') {
    return false;
  }
  return JSON.stringify(actual) === JSON.stringify(expected);
}
