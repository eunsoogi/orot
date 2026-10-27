'use strict';

const { createRequire } = require('node:module');
const path = require('node:path');
// Resolve the pinned standard APIs from their owning workspace, without adding evaluator dependencies.
const ragRequire = createRequire(path.resolve(__dirname, '../../../packages/rag/package.json'));
const { BaseRetriever } = ragRequire('@langchain/core/retrievers');
const { VectorStore } = ragRequire('@langchain/core/vectorstores');
const { documentToEvidenceChunk, evidenceChunkToDocument } = require('@orot/rag');

/** Offline fixture VectorStore; production persistence and native inference are separate proof. */
class SyntheticVectorStore extends VectorStore {
  constructor(embeddings) {
    super(embeddings, {});
    this.entries = new Map();
  }
  _vectorstoreType() {
    return 'orot_synthetic_evaluation';
  }
  async addDocuments(documents) {
    const snapshot = documents.map(documentToEvidenceChunk).map(evidenceChunkToDocument);
    return this.addVectors(
      await this.embeddings.embedDocuments(snapshot.map((value) => value.pageContent)),
      snapshot,
    );
  }
  async addVectors(vectors, documents) {
    if (vectors.length !== documents.length) throw new Error('Vectors must match documents.');
    documents.forEach((document, index) => {
      const snapshot = evidenceChunkToDocument(documentToEvidenceChunk(document));
      this.entries.set(document.id, { document: snapshot, vector: [...vectors[index]] });
    });
    return documents.map((document) => document.id);
  }
  async similaritySearchVectorWithScore(query, limit, candidates) {
    const hits = candidates.flatMap((chunk) => {
      const entry = this.entries.get(chunk.id);
      if (
        !entry ||
        JSON.stringify(entry.document) !== JSON.stringify(evidenceChunkToDocument(chunk))
      )
        return [];
      const dot = entry.vector.reduce((sum, value, i) => sum + value * query[i], 0);
      const norm = Math.hypot(...query) * Math.hypot(...entry.vector);
      const score = dot / norm;
      return Number.isFinite(score) ? [[entry.document, score]] : [];
    });
    return hits
      .sort(([a, left], [b, right]) => right - left || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, limit);
  }
}

/** Fixture lexical ranking is supplied by the same deterministic token policy as before. */
class SyntheticLexicalRetriever extends BaseRetriever {
  lc_namespace = ['orot', 'evaluation', 'lexical'];
  constructor(request, textStore, signal) {
    super();
    this.request = request;
    this.textStore = textStore;
    this.signal = signal;
  }
  async _getRelevantDocuments(query) {
    const matches = await this.textStore.search(
      query,
      this.request.chunks,
      this.request.limit,
      this.signal,
    );
    const chunks = new Map(this.request.chunks.map((chunk) => [chunk.id, chunk]));
    return matches.flatMap((match) =>
      chunks.has(match.chunkId) ? [evidenceChunkToDocument(chunks.get(match.chunkId))] : [],
    );
  }
}

module.exports = { SyntheticVectorStore, SyntheticLexicalRetriever };
