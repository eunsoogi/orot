import type { DocumentInterface } from '@langchain/core/documents';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';
import type { Callbacks } from '@langchain/core/callbacks/manager';
import {
  VectorStore,
  type VectorStoreRetriever,
  type VectorStoreRetrieverInput,
} from '@langchain/core/vectorstores';
import {
  evidenceChunkToDocument,
  filterEvidenceChunks,
  type EvidenceChunk,
  type EvidenceSearchFilters,
  type LocalEmbeddingModelIdentity,
} from '@orot/rag';
import type { SqlDatabase, SqlTransaction } from '@orot/storage';
import { SqlCipherRagEmbeddingStorage } from './ragEmbeddingStorage';
import { validateVector } from './ragEmbeddingVector';
import {
  eligibleVectorChunks,
  evidenceIdentities,
  MAX_VECTOR_CANDIDATES,
  vectorStoreChunks,
} from './ragVectorStoreEvidence';
import {
  prepareVectorRevisions,
  readVectorRevisions,
  saveVectorRevision,
  vectorDocumentFingerprint,
} from './ragVectorStoreRevision';
import {
  PrivateVectorStoreRetriever,
  vectorSimilarity,
} from './sqlCipherVectorStoreSupport';

export interface SqlCipherVectorFilter extends EvidenceSearchFilters {
  /** Caller-owned bounded evidence page, never an implicit full-database scan. */
  readonly candidates: readonly EvidenceChunk[];
}

type ModelEmbeddings = EmbeddingsInterface & {
  readonly modelIdentity: LocalEmbeddingModelIdentity;
};

// LangChain uses this member only as a type marker; merging avoids emitting a runtime field.
export interface SqlCipherVectorStore {
  FilterType: SqlCipherVectorFilter;
}

/**
 * Standard VectorStore over the app's open SQLCipher connection. Documents remain
 * caller-owned evidence snapshots; only vectors and revision digests are persisted.
 * A missing candidate filter is rejected rather than widening the evidence scope.
 */
export class SqlCipherVectorStore extends VectorStore {
  private readonly model: LocalEmbeddingModelIdentity;
  private readonly storage: SqlCipherRagEmbeddingStorage;

  constructor(
    embeddings: ModelEmbeddings,
    private readonly database: SqlDatabase,
  ) {
    super(embeddings, {});
    this.model = { ...embeddings.modelIdentity };
    if (
      !Number.isInteger(this.model.dimension) ||
      this.model.dimension < 1 ||
      !this.model.id ||
      !this.model.revision
    )
      throw new Error('Invalid embedding model identity.');
    this.storage = new SqlCipherRagEmbeddingStorage(database);
  }

  _vectorstoreType(): string {
    return 'orot_sqlcipher';
  }

  override asRetriever(
    kOrFields?: number | Partial<VectorStoreRetrieverInput<this>>,
    filter?: SqlCipherVectorFilter,
    callbacks?: Callbacks,
    tags?: string[],
    metadata?: Record<string, unknown>,
    verbose?: boolean,
  ): VectorStoreRetriever<this> {
    // Keep LangChain's overload normalization and MMR defaults, then replace only
    // its callback-enabled retriever with the content-private implementation.
    const standard = super.asRetriever(
      kOrFields,
      filter,
      callbacks,
      tags,
      metadata,
      verbose,
    );
    return new PrivateVectorStoreRetriever({
      vectorStore: this,
      k: standard.k,
      filter: standard.filter,
      searchType: standard.searchType === 'mmr' ? 'mmr' : 'similarity',
      searchKwargs: standard.searchKwargs,
      callbacks: standard.callbacks,
      tags: standard.tags,
      metadata: standard.metadata,
      verbose: standard.verbose,
    }) as unknown as VectorStoreRetriever<this>;
  }

  async addDocuments(documents: DocumentInterface[]): Promise<string[]> {
    const snapshot = vectorStoreChunks(documents).map(evidenceChunkToDocument);
    const vectors = await this.embeddings.embedDocuments(
      snapshot.map(document => document.pageContent),
    );
    return this.addVectors(vectors, snapshot);
  }

  async addVectors(
    vectors: number[][],
    documents: DocumentInterface[],
  ): Promise<string[]> {
    const chunks = vectorStoreChunks(documents);
    if (vectors.length !== chunks.length)
      throw new Error('Vectors must match document count.');
    vectors.forEach(vector => validateVector(this.model, vector));
    // Native embedding arrays and caller-owned documents may change while hashing yields.
    vectors = vectors.map(vector => Array.from(vector, Math.fround));
    const fingerprints = await Promise.all(
      chunks.map((chunk, index) =>
        vectorDocumentFingerprint(chunk, vectors[index]),
      ),
    );
    await this.prepare();
    await this.database.transaction(async transaction => {
      const storage = this.transactionStorage(transaction);
      const eligible = await eligibleVectorChunks(chunks, storage);
      if (eligible.length !== chunks.length)
        throw new Error('Removed evidence cannot be indexed again.');
      await storage.upsertBatch(
        this.model,
        chunks.map((chunk, index) => ({
          chunkId: chunk.id,
          vector: vectors[index],
          sourceRecordIds: evidenceIdentities(chunk),
        })),
      );
      for (let index = 0; index < chunks.length; index += 1) {
        await saveVectorRevision(
          transaction,
          this.model,
          chunks[index].id,
          fingerprints[index],
        );
      }
    });
    return chunks.map(chunk => chunk.id);
  }

  /** Explicit IDs fence those chunks across all models, including delayed in-flight writes. */
  async delete(
    params: { ids?: string[]; sourceRecordIds?: string[] } = {},
  ): Promise<void> {
    if (!params.ids && !params.sourceRecordIds)
      throw new Error('Deletion needs explicit evidence identities.');
    await this.storage.deleteEvidence(
      params.sourceRecordIds ?? [],
      params.ids ?? [],
    );
  }

  async similaritySearchVectorWithScore(
    query: number[],
    k: number,
    filter?: SqlCipherVectorFilter,
  ): Promise<[DocumentInterface, number][]> {
    validateVector(this.model, query);
    if (!Number.isInteger(k) || k < 1 || k > MAX_VECTOR_CANDIDATES) {
      throw new Error('Vector result count must be between 1 and 500.');
    }
    if (
      !filter ||
      !Array.isArray(filter.candidates) ||
      filter.candidates.length > MAX_VECTOR_CANDIDATES
    ) {
      throw new Error(
        'Vector search needs an explicit candidate page of at most 500 chunks.',
      );
    }
    // Conversion clones the page before asynchronous SQL or native hashing can yield control.
    const chunks = filterEvidenceChunks(
      vectorStoreChunks(filter.candidates.map(evidenceChunkToDocument)),
      filter,
    );
    if (chunks.length === 0) return [];
    await this.prepare();
    let hits: [DocumentInterface, number][] = [];
    await this.database.transaction(async transaction => {
      const storage = this.transactionStorage(transaction);
      const candidates = await eligibleVectorChunks(chunks, storage);
      const ids = candidates.map(chunk => chunk.id);
      const vectors = new Map(
        (await storage.listForModel(this.model, ids)).map(entry => [
          entry.chunkId,
          entry.vector,
        ]),
      );
      const revisions = await readVectorRevisions(transaction, this.model, ids);
      for (const chunk of candidates) {
        const vector = vectors.get(chunk.id);
        if (!vector) continue;
        // Stable chunk IDs survive corrections. Never pair a new document with an old vector,
        // or trust a legacy writer that replaced the blob without updating this revision digest.
        const fingerprint = await vectorDocumentFingerprint(chunk, vector);
        if (revisions.get(chunk.id) !== fingerprint) continue;
        const score = vectorSimilarity(query, vector);
        if (Number.isFinite(score))
          hits.push([evidenceChunkToDocument(chunk), score]);
      }
    });
    hits.sort(
      ([left, a], [right, b]) =>
        b - a || (left.id! < right.id! ? -1 : left.id! > right.id! ? 1 : 0),
    );
    return hits.slice(0, k);
  }

  private async prepare(): Promise<void> {
    await this.storage.prepare();
    await prepareVectorRevisions(this.database);
  }

  private transactionStorage(
    transaction: SqlTransaction,
  ): SqlCipherRagEmbeddingStorage {
    // Join one owning transaction for vector/revision writes and deletion/freshness reads.
    // The facade does not commit or open a nested transaction on the native connection.
    return new SqlCipherRagEmbeddingStorage({
      execute: (sql, values) => transaction.execute(sql, values),
      transaction: operation => operation(transaction),
    });
  }
}
