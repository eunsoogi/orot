import type { SqlDatabase } from '@orot/storage';
import { listConversationSessionPage } from './conversationSessionPages';

/** Hide immediately from discovery while keeping one recoverable undo until finalization. */
export function createConversationSessionVisibility(
  database: SqlDatabase,
  ensure: () => Promise<void>,
) {
  return {
    async activeSessionVersion(id: string) {
      await ensure();
      const result = await database.execute(
        'SELECT s.version FROM conversation_artifact_sessions s JOIN conversation_artifact_generation g ON g.singleton = 1 AND s.generation = g.generation WHERE s.id = ? AND s.hidden = 0',
        [id],
      );
      if (!result.rows.length) return null;
      const version = result.rows[0]?.version;
      if (
        typeof version !== 'number' ||
        !Number.isSafeInteger(version) ||
        version < 0
      )
        throw new Error('Conversation session state is invalid.');
      return version;
    },
    async listSessions(
      cursor?: { readonly updatedAt: string; readonly id: string },
      limit = 50,
    ) {
      await ensure();
      return listConversationSessionPage(database, cursor, limit);
    },
    async hideSession(id: string, expectedVersion = 0) {
      if (
        !Number.isSafeInteger(expectedVersion) ||
        expectedVersion < 0 ||
        expectedVersion >= Number.MAX_SAFE_INTEGER
      )
        throw new Error('Conversation session version is invalid.');
      await ensure();
      let version: number | null = null;
      await database.transaction(async tx => {
        const session = await tx.execute(
          'SELECT hidden, version FROM conversation_artifact_sessions WHERE id = ?',
          [id],
        );
        if (!session.rows.length) {
          // A late asynchronous create cannot revive an already deleted session.
          await tx.execute(
            'INSERT OR IGNORE INTO conversation_artifact_removed_sessions (id) VALUES (?)',
            [id],
          );
          return;
        }
        const row = session.rows[0]!;
        if (
          typeof row.version !== 'number' ||
          !Number.isSafeInteger(row.version) ||
          row.version < 0 ||
          (row.hidden !== 0 && row.hidden !== 1) ||
          (row.hidden === 0 && row.version !== expectedVersion) ||
          (row.hidden === 1 && row.version !== expectedVersion + 1)
        )
          throw new Error('Conversation session state is invalid.');
        version = row.hidden === 1 ? row.version : row.version + 1;
        if (row.hidden === 0)
          await tx.execute(
            'UPDATE conversation_artifact_sessions SET hidden = 1, version = ? WHERE id = ?',
            [version, id],
          );
      });
      return version;
    },
    async undoHiddenSession(id: string, expectedVersion: number) {
      if (
        !Number.isSafeInteger(expectedVersion) ||
        expectedVersion < 1 ||
        expectedVersion >= Number.MAX_SAFE_INTEGER
      )
        throw new Error('Conversation session version is invalid.');
      await ensure();
      await database.transaction(async tx => {
        const result = await tx.execute(
          'SELECT s.id FROM conversation_artifact_sessions s JOIN conversation_artifact_generation g ON g.singleton = 1 AND s.generation = g.generation WHERE s.id = ? AND s.hidden = 1 AND s.version = ?',
          [id, expectedVersion],
        );
        if (!result.rows.length)
          throw new Error('The deleted conversation is no longer recoverable.');
        // Each output is revalidated by read before any content or source link is returned.
        await tx.execute(
          'UPDATE conversation_artifact_sessions SET hidden = 0, version = version + 1 WHERE id = ?',
          [id],
        );
      });
      return expectedVersion + 1;
    },
    async finalizeHiddenSessions() {
      await ensure();
      await database.transaction(async tx => {
        await tx.execute(
          'DELETE FROM conversation_artifact_sessions WHERE hidden = 1',
        );
      });
    },
    async finalizeHiddenSession(id: string, version: number) {
      await ensure();
      await database.transaction(async tx => {
        const found = await tx.execute(
          'SELECT id FROM conversation_artifact_sessions WHERE id = ? AND hidden = 1 AND version = ?',
          [id, version],
        );
        if (found.rows.length)
          await tx.execute(
            'DELETE FROM conversation_artifact_sessions WHERE id = ? AND hidden = 1 AND version = ?',
            [id, version],
          );
      });
    },
  };
}
