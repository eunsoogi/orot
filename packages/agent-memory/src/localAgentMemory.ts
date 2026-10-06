import { Memory } from 'rememori';
import type { Embedder, RecallOptions } from 'rememori';
import type { AgentMemoryHit, AgentMemoryInput, AgentMemoryStorageAdapter } from './types';
import type { AgentMemoryService, AgentMemorySourceRemovalResult } from './service';
import {
  isAgentMemoryKind,
  isProvenance,
  metadataFrom,
  provenanceFrom,
  samePayload,
  validateInput,
} from './validation';

export class LocalAgentMemory implements AgentMemoryService {
  private engine: Memory | null = null;
  private tail: Promise<void> = Promise.resolve();
  private closed = false;
  private removedSourceIds = new Set<string>();
  private invalidatedSourceIds = new Set<string>();

  constructor(
    private readonly embedder: Embedder,
    private readonly storage: AgentMemoryStorageAdapter,
  ) {}

  async open(): Promise<void> {
    this.removedSourceIds = new Set(await this.storage.listRemovedSourceIds());
    this.invalidatedSourceIds = new Set(await this.storage.listInvalidatedSourceIds());
    this.engine = await this.openEngine();
  }

  remember(input: AgentMemoryInput): Promise<string> {
    return this.enqueue(() => this.write(input));
  }

  update(input: AgentMemoryInput): Promise<string> {
    return this.enqueue(() => this.write(input));
  }

  recall(
    query: string,
    options: Pick<RecallOptions, 'limit' | 'tags' | 'minSimilarity'> = {},
  ): Promise<AgentMemoryHit[]> {
    return this.enqueue(async () => {
      if (!query.trim()) throw new Error('A non-empty memory query is required.');
      // Transcript corrections can arrive while this memory engine remains open.
      const invalidatedSourceIds = new Set(await this.storage.listInvalidatedSourceIds());
      await this.refreshEngineForInvalidatedSources(invalidatedSourceIds);
      const hits = await (await this.getEngine()).recall(query, { ...options, graph: false });
      return hits.flatMap((hit) => {
        const metadata = metadataFrom(hit.meta);
        if (!metadata || !isAgentMemoryKind(metadata.kind) || !isProvenance(metadata.provenance)) {
          return [];
        }
        if (metadata.provenance.sourceIds.some((sourceId) => invalidatedSourceIds.has(sourceId))) {
          return [];
        }
        return [
          {
            id: hit.id,
            text: hit.text,
            score: hit.score,
            kind: metadata.kind,
            provenance: metadata.provenance,
            createdAt: hit.createdAt,
          },
        ];
      });
    });
  }

  forget(memoryId: string): Promise<boolean> {
    return this.enqueue(async () => {
      const records = await this.storage.listRecords();
      if (!records.some((record) => record.id === memoryId)) return false;
      return this.runBatch(async () => (await this.getEngine()).forget(memoryId));
    });
  }

  forgetBySourceId(sourceId: string): Promise<number> {
    return this.enqueue(async () => {
      const normalizedId = sourceId.trim();
      if (!normalizedId) throw new Error('A source identifier is required.');
      const records = await this.storage.listRecords();
      const ids = records
        .filter((record) => provenanceFrom(record.meta)?.sourceIds.includes(normalizedId))
        .map((record) => record.id);
      if (ids.length === 0) return 0;
      return this.runBatch(async () => {
        const engine = await this.getEngine();
        let forgotten = 0;
        for (const id of ids) if (await engine.forget(id)) forgotten += 1;
        return forgotten;
      });
    });
  }

  removeSource(
    sourceId: string,
    deleteSourceRecord: () => Promise<boolean>,
  ): Promise<AgentMemorySourceRemovalResult> {
    return this.enqueue(async () => {
      const normalizedId = sourceId.trim();
      if (!normalizedId) throw new Error('A source identifier is required.');
      this.removedSourceIds.add(normalizedId);

      const records = await this.storage.listRecords();
      const ids = records
        .filter((record) => provenanceFrom(record.meta)?.sourceIds.includes(normalizedId))
        .map((record) => record.id);
      const memoriesDeleted = await this.runBatch(async () => {
        const engine = await this.getEngine();
        let forgotten = 0;
        for (const id of ids) if (await engine.forget(id)) forgotten += 1;
        await this.storage.markSourceRemoved(normalizedId);
        return forgotten;
      });
      const sourceDeleted = await deleteSourceRecord();
      return { sourceDeleted, memoriesDeleted };
    });
  }

  close(): Promise<void> {
    return this.enqueue(async () => {
      if (this.closed) return;
      this.closed = true;
      await (await this.getEngine()).close();
      this.engine = null;
    }, true);
  }

  private async write(input: AgentMemoryInput): Promise<string> {
    const normalized = validateInput(input);
    const invalidatedSourceIds = new Set(await this.storage.listInvalidatedSourceIds());
    const invalidatedSourceId = normalized.provenance.sourceIds.find((sourceId) =>
      invalidatedSourceIds.has(sourceId),
    );
    if (invalidatedSourceId)
      throw new Error('Memory cannot reference a superseded transcript revision.');
    const removedSourceId = normalized.provenance.sourceIds.find((sourceId) =>
      this.removedSourceIds.has(sourceId),
    );
    if (removedSourceId)
      throw new Error('Memory cannot reference a source being or already removed.');
    const records = await this.storage.listRecords();
    const matches = records.filter(
      (record) => metadataFrom(record.meta).memoryKey === normalized.memoryKey,
    );
    const current = [...matches].sort((left, right) => right.createdAt - left.createdAt)[0];
    const identical = current && samePayload(current, normalized);

    if (identical && matches.length === 1) return current.id;
    return this.runBatch(async () => {
      const engine = await this.getEngine();
      if (identical) {
        for (const duplicate of matches)
          if (duplicate.id !== current.id) await engine.forget(duplicate.id);
        return current.id;
      }
      const id = await engine.remember(normalized.text, {
        tags: [normalized.kind],
        importance: normalized.importance,
        entities: [],
        meta: {
          memoryKey: normalized.memoryKey,
          kind: normalized.kind,
          provenance: normalized.provenance,
        },
      });
      for (const record of matches) await engine.forget(record.id);
      return id;
    });
  }

  private async runBatch<T>(operation: () => Promise<T>): Promise<T> {
    this.storage.beginBatch();
    try {
      const result = await operation();
      await this.storage.commitBatch();
      return result;
    } catch (error) {
      this.storage.rollbackBatch();
      this.engine = null;
      await this.getEngine();
      throw error;
    }
  }

  private async getEngine(): Promise<Memory> {
    if (!this.engine) this.engine = await this.openEngine();
    return this.engine;
  }

  private async refreshEngineForInvalidatedSources(
    invalidatedSourceIds: Set<string>,
  ): Promise<void> {
    const changed =
      invalidatedSourceIds.size !== this.invalidatedSourceIds.size ||
      [...invalidatedSourceIds].some((sourceId) => !this.invalidatedSourceIds.has(sourceId));
    if (!changed) return;

    // Rememori ranks before returning its limited result set; reopen after a transcript correction so stale indexed hits cannot consume the caller's limit.
    const previousEngine = this.engine;
    this.engine = null;
    if (previousEngine) await previousEngine.close();
    this.engine = await this.openEngine();
    this.invalidatedSourceIds = invalidatedSourceIds;
  }

  private openEngine(): Promise<Memory> {
    return Memory.open(':memory:', {
      embedder: this.embedder,
      storage: this.storage,
      extractor: false,
      index: 'flat',
    });
  }

  private enqueue<T>(operation: () => Promise<T>, allowClosed = false): Promise<T> {
    const result = this.tail.then(async () => {
      if (this.closed && !allowClosed) throw new Error('Agent memory is closed.');
      return operation();
    });
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
