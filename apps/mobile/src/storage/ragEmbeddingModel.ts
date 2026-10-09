import type { LocalEmbeddingModelIdentity } from '@orot/rag';
import type { SqlExecutor } from '@orot/storage';

export const EMBEDDING_MODELS_TABLE = 'rag_embedding_models';

/** Checks that a persisted revision still names the same model and tokenizer files. */
export async function verifyModelRow(
  executor: SqlExecutor,
  model: LocalEmbeddingModelIdentity,
): Promise<boolean> {
  const result = await executor.execute(
    `SELECT dimension, model_sha256, tokenizer_sha256 FROM ${EMBEDDING_MODELS_TABLE} WHERE model_id = ? AND model_revision = ?`,
    [model.id, model.revision],
  );
  const row = result.rows[0];
  if (!row) return false;
  if (
    row.dimension !== model.dimension ||
    row.model_sha256 !== model.modelSha256 ||
    row.tokenizer_sha256 !== model.tokenizerSha256
  ) {
    throw new Error(
      'A model revision cannot be reused with different embedding identity metadata.',
    );
  }
  return true;
}

/** Persists a model identity once and rejects conflicting metadata for that revision. */
export async function ensureModelRow(
  executor: SqlExecutor,
  model: LocalEmbeddingModelIdentity,
): Promise<void> {
  await executor.execute(
    `INSERT INTO ${EMBEDDING_MODELS_TABLE} (model_id, model_revision, dimension, model_sha256, tokenizer_sha256) VALUES (?, ?, ?, ?, ?) ON CONFLICT(model_id, model_revision) DO NOTHING`,
    [
      model.id,
      model.revision,
      model.dimension,
      model.modelSha256,
      model.tokenizerSha256,
    ],
  );
  if (!(await verifyModelRow(executor, model))) {
    throw new Error('The embedding model identity row could not be persisted.');
  }
}
