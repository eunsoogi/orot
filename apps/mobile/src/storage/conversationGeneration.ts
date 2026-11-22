import type { SqlExecutor } from '@orot/storage';

/** The shared lease generation must be read from the owning executor. */
export async function readConversationGeneration(
  tx: SqlExecutor,
): Promise<number> {
  const result = await tx.execute(
    'SELECT generation FROM conversation_artifact_generation WHERE singleton = 1',
  );
  const value = result.rows[0]?.generation;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('Conversation generation is unavailable.');
  return value;
}
