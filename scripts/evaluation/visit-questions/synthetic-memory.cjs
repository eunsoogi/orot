'use strict';

const {
  AGENT_MEMORY_NAMESPACE,
  createAgentMemory,
  createAgentMemoryStoreView,
  createRememoriEmbedder,
  RememoriLangGraphStore,
} = require('@orot/agent-memory');
const { createSyntheticEmbeddingProvider, vectorFor } = require('./synthetic-rag.cjs');

/** Small in-memory persistence keeps the real Rememori service and graph Store available offline. */
class SyntheticMemoryStorage {
  constructor() {
    this.records = new Map();
    this.removedSourceIds = new Set();
    this.invalidatedSourceIds = new Set();
    this.pending = null;
  }

  async load() {
    return this.listRecords();
  }

  async listRecords() {
    return [...this.records.values()].filter(
      (record) => !record.meta.provenance.sourceIds.some((id) => this.removedSourceIds.has(id)),
    );
  }

  async listRemovedSourceIds() {
    return [...this.removedSourceIds];
  }

  async listInvalidatedSourceIds() {
    return [...this.invalidatedSourceIds];
  }

  async append(record) {
    if (this.pending) this.pending.set(record.id, record);
    else this.records.set(record.id, record);
  }

  async tombstone(id) {
    if (this.pending) this.pending.set(id, null);
    else this.records.delete(id);
  }

  async markSourceRemoved(id) {
    this.removedSourceIds.add(id);
  }

  beginBatch() {
    if (this.pending) throw new Error('A synthetic memory write batch is already open.');
    this.pending = new Map();
  }

  async commitBatch() {
    if (!this.pending) throw new Error('No synthetic memory write batch is open.');
    for (const [id, record] of this.pending) {
      if (record) this.records.set(id, record);
      else this.records.delete(id);
    }
    this.pending = null;
  }

  rollbackBatch() {
    this.pending = null;
  }

  async compact(records) {
    this.records = new Map(records.map((record) => [record.id, record]));
  }

  async close() {}
}

function normalizedVector(text) {
  const vector = Float32Array.from(vectorFor(text));
  const norm = Math.sqrt(vector.reduce((sum, part) => sum + part * part, 0));
  return norm === 0 ? vector : Float32Array.from(vector, (part) => part / norm);
}

async function createSyntheticMemory(reviewedMemory, fixtureId, trace) {
  const storage = new SyntheticMemoryStorage();
  const provider = createSyntheticEmbeddingProvider();
  const embedder = createRememoriEmbedder(provider);
  const memoryKey = `synthetic-reviewed-visit:${fixtureId}`;
  const provenance = {
    sourceIds: [...reviewedMemory.sourceRecordIds],
    sourceDates: reviewedMemory.sourceRecordIds.map((sourceId) => ({
      sourceId,
      date: reviewedMemory.effectiveAt,
    })),
    reviewState: 'human_reviewed',
  };
  // A stable persisted Rememori ID keeps fixture citations reproducible across runs.
  await storage.append({
    id: reviewedMemory.id,
    text: reviewedMemory.content,
    vector: normalizedVector(reviewedMemory.content),
    tags: ['reviewed_interaction'],
    entities: [],
    importance: 1,
    meta: { memoryKey, kind: 'reviewed_interaction', provenance },
    createdAt: Date.parse(reviewedMemory.effectiveAt),
    reinforcements: 0,
  });
  const memory = await createAgentMemory({ storage, embedder });
  const store = createAgentMemoryStoreView(
    memory,
    new RememoriLangGraphStore({ storage, embedder }),
  );
  const originalBatch = store.batch.bind(store);
  store.batch = async (operations) => {
    if (
      operations.some(
        (operation) =>
          'namespacePrefix' in operation &&
          operation.namespacePrefix[0] === AGENT_MEMORY_NAMESPACE[0] &&
          operation.query,
      )
    ) {
      trace.memoryStoreSearches += 1;
    }
    return originalBatch(operations);
  };
  const queryReader = {
    recall(query, options) {
      trace.memoryQueryServiceSearches += 1;
      return memory.recall(query, options);
    },
  };
  const memoryHit = await memory.getById(reviewedMemory.id);
  if (!memoryHit) throw new Error('The synthetic reviewed-memory row could not be reopened.');
  return {
    memory,
    store,
    queryReader,
    memoryHit: { ...memoryHit, score: 0 },
    async close() {
      await store.stop();
      await memory.close();
    },
  };
}

module.exports = { createSyntheticMemory };
