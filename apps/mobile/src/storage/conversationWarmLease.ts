import type { SqlExecutor } from '@orot/storage';
import type { ConversationModelIdentity } from './continuousConversationStorage';

/** Reuse an existing pointer without repair; proposals also bind one retained active request. */
export function createConversationWarmLeaseReader(
  database: SqlExecutor,
  ensure: () => Promise<void>,
) {
  return async (
    model: ConversationModelIdentity,
    lease: { id: string; version: number },
    signal: AbortSignal,
    activeRequestId?: string,
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
         AND NOT EXISTS (SELECT 1 FROM conversation_artifact_removed_sessions d WHERE d.id = s.id)
         ${
           activeRequestId === undefined
             ? ''
             : `AND EXISTS (
           SELECT 1 FROM conversation_requests r WHERE r.id = ? AND r.session_id = s.id
             AND r.session_version = s.version AND r.status = 'active'
         )`
         }`,
      [
        model.providerId,
        model.modelId,
        lease.id,
        lease.version,
        ...(activeRequestId === undefined ? [] : [activeRequestId]),
      ],
    );
    return !signal.aborted && rows[0]?.current === 1;
  };
}
