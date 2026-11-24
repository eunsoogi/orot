import type { SqlExecutor } from '@orot/storage';
import { EMBEDDING_MODELS_TABLE } from './ragEmbeddingModel';

export const EMBEDDINGS_TABLE = 'rag_embeddings';
export const EMBEDDING_SOURCES_TABLE = 'rag_embedding_sources';
export const REMOVED_CHUNKS_TABLE = 'rag_embedding_removed_chunks';
export const REMOVED_SOURCES_TABLE = 'rag_embedding_removed_sources';

// SQLite retains the CREATE definition in main.sqlite_master without IF NOT EXISTS.
export const embeddingSchema = {
  models: `CREATE TABLE ${EMBEDDING_MODELS_TABLE} (model_id TEXT NOT NULL, model_revision TEXT NOT NULL, dimension INTEGER NOT NULL, model_sha256 TEXT NOT NULL, tokenizer_sha256 TEXT NOT NULL, PRIMARY KEY (model_id, model_revision))`,
  vectors: `CREATE TABLE ${EMBEDDINGS_TABLE} (chunk_id TEXT NOT NULL, model_id TEXT NOT NULL, model_revision TEXT NOT NULL, dimension INTEGER NOT NULL, vector_blob BLOB NOT NULL, PRIMARY KEY (chunk_id, model_id, model_revision))`,
  modelIndex: `CREATE INDEX rag_embeddings_model_idx ON ${EMBEDDINGS_TABLE} (model_id, model_revision, dimension)`,
  removedChunks: `CREATE TABLE ${REMOVED_CHUNKS_TABLE} (chunk_id TEXT PRIMARY KEY NOT NULL)`,
  removedSources: `CREATE TABLE ${REMOVED_SOURCES_TABLE} (source_record_id TEXT PRIMARY KEY NOT NULL)`,
  sources: `CREATE TABLE ${EMBEDDING_SOURCES_TABLE} (chunk_id TEXT NOT NULL, source_record_id TEXT NOT NULL, PRIMARY KEY (chunk_id, source_record_id))`,
  sourceIndex: `CREATE INDEX rag_embedding_sources_source_idx ON ${EMBEDDING_SOURCES_TABLE} (source_record_id, chunk_id)`,
};

export function createEmbeddingSchemaIfAbsent(ddl: string): string {
  return ddl.replace(/^CREATE (TABLE|INDEX) /, 'CREATE $1 IF NOT EXISTS ');
}

/** Check exact definitions in the caller's transaction, never a prior connection or snapshot. */
export async function hasExactEmbeddingSchema(
  executor: SqlExecutor,
): Promise<boolean> {
  const definitions = Object.values(embeddingSchema);
  const result = await executor.execute(
    `SELECT COUNT(*) AS ready FROM main.sqlite_master WHERE sql IN (${definitions.map(() => '?').join(', ')})`,
    definitions,
  );
  return result.rows[0]?.ready === definitions.length;
}
