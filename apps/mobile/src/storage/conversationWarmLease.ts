import type { SqlExecutor } from '@orot/storage';
import type { ConversationModelIdentity } from './continuousConversationStorage';

/** A warm send may reuse an existing pointer, never create, adopt, or repair one. */
export function createConversationWarmLeaseReader(
  database: SqlExecutor,
  ensure: () => Promise<void>,
) {
  return async (
    model: ConversationModelIdentity,
    lease: { id: string; version: number },
    signal: AbortSignal,
  ) => {
    if (signal.aborted) return false;
    await ensure();
    if (signal.aborted) return false;
    const { rows } = await database.execute(
      `SELECT 1 AS current FROM conversation_active_model m
       JOIN conversation_artifact_generation g ON g.singleton = 1 AND g.generation = m.generation
       JOIN conversation_artifact_sessions s ON s.id = m.session_id AND s.generation = g.generation
       WHERE m.singleton = 1 AND m.provider_id = ? AND m.model_id = ?
         AND s.id = ? AND s.version = ? AND s.hidden = 0
         AND NOT EXISTS (SELECT 1 FROM conversation_artifact_removed_sessions d WHERE d.id = s.id)`,
      [model.providerId, model.modelId, lease.id, lease.version],
    );
    return !signal.aborted && rows[0]?.current === 1;
  };
}
