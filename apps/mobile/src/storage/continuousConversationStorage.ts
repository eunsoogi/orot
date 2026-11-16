import type { SqlDatabase } from '@orot/storage';
import { listConversationSessionPage } from './conversationSessionPages';

export type ConversationModelIdentity = { providerId: string; modelId: string };
/** The pointer contains no transcript or credentials and lives in the existing protected DB.
 * One transaction selects/creates the lease; model A -> B -> A creates three epochs. */
export function continuousConversationStorage(
  database: SqlDatabase,
  ensure: () => Promise<void>,
) {
  return async (
    model: ConversationModelIdentity,
    newId: string,
    now: string,
    signal: AbortSignal,
  ) => {
    for (const value of [model.providerId, model.modelId, newId])
      if (!value || value.trim() !== value || value.length > 1024)
        throw new Error('Invalid continuous conversation identity.');
    if (
      newId.length > 200 ||
      !Number.isFinite(Date.parse(now)) ||
      new Date(now).toISOString() !== now
    )
      throw new Error('Invalid continuous conversation lease.');
    await ensure();
    let resolved!: { id: string; version: number; updatedAt: string };
    await database.transaction(async tx => {
      const current = () => {
        if (signal.aborted)
          throw new Error('Conversation selection cancelled.');
      };
      current();
      await tx.execute(
        'CREATE TABLE IF NOT EXISTS conversation_active_model (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), provider_id TEXT NOT NULL, model_id TEXT NOT NULL, session_id TEXT NOT NULL, generation INTEGER NOT NULL, created_at TEXT NOT NULL)',
      );
      // Explicit clearing removes even the private pointer; it never retains an old conversation id.
      await tx.execute(
        'CREATE TRIGGER IF NOT EXISTS conversation_active_model_clear AFTER UPDATE OF generation ON conversation_artifact_generation WHEN OLD.generation != NEW.generation BEGIN DELETE FROM conversation_active_model; END',
      );
      const generation = (
        await tx.execute(
          'SELECT generation FROM conversation_artifact_generation WHERE singleton = 1',
        )
      ).rows[0]?.generation;
      if (
        typeof generation !== 'number' ||
        !Number.isSafeInteger(generation) ||
        generation < 0
      )
        throw new Error('Conversation generation unavailable.');
      const pointer = (
        await tx.execute(
          'SELECT * FROM conversation_active_model WHERE singleton = 1',
        )
      ).rows[0];
      if (
        pointer &&
        pointer.generation === generation &&
        pointer.provider_id === model.providerId &&
        pointer.model_id === model.modelId
      ) {
        const row = (
          await tx.execute(
            'SELECT id, version FROM conversation_artifact_sessions WHERE id = ? AND generation = ? AND hidden = 0',
            [pointer.session_id as string, generation],
          )
        ).rows[0];
        if (row) {
          if (
            typeof row.id !== 'string' ||
            typeof row.version !== 'number' ||
            !Number.isSafeInteger(row.version) ||
            row.version < 0 ||
            typeof pointer.created_at !== 'string' ||
            !Number.isFinite(Date.parse(pointer.created_at))
          )
            throw new Error('Invalid continuous conversation metadata.');
          current();
          resolved = {
            id: row.id as string,
            version: row.version as number,
            updatedAt: pointer.created_at as string,
          };
          return;
        }
        // A hidden/deleted current session is not permission to resurrect or silently replace it.
        throw new Error('The continuous conversation is unavailable.');
      }
      // One-time migration adopts the most recent visible legacy session without deleting others.
      // An existing pointer, including one from before an explicit clear, never triggers adoption.
      const legacy = !pointer
        ? (await listConversationSessionPage(tx, undefined, 1)).items[0]
        : undefined;
      const id = legacy?.id ?? newId;
      const version = legacy?.version ?? 0;
      const updatedAt = legacy?.updatedAt ?? now;
      if (!legacy)
        await tx.execute(
          'INSERT INTO conversation_artifact_sessions (id, generation) VALUES (?, ?)',
          [id, generation],
        );
      current();
      await tx.execute(
        'INSERT OR REPLACE INTO conversation_active_model (singleton, provider_id, model_id, session_id, generation, created_at) VALUES (1, ?, ?, ?, ?, ?)',
        [model.providerId, model.modelId, id, generation, updatedAt],
      );
      current();
      resolved = { id, version, updatedAt };
    });
    return resolved;
  };
}
