import type { SqlDatabase } from '@orot/storage';
import { createConversationArtifactStorage } from './conversationArtifactStorage';

export type ConversationReadingPosition = {
  turnId: string;
  role: 'user' | 'assistant';
  offset: number;
  bottom: boolean;
};
const validId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 200;
const validPosition = (p: ConversationReadingPosition) =>
  validId(p.turnId) &&
  (p.role === 'user' || p.role === 'assistant') &&
  Number.isFinite(p.offset) &&
  p.offset >= 0 &&
  p.offset <= 1000000 &&
  typeof p.bottom === 'boolean';
const targetExists = `EXISTS (SELECT 1 FROM conversation_artifacts WHERE session_id = ? AND id = ?)
  OR EXISTS (SELECT 1 FROM conversation_tool_events WHERE session_id = ? AND message_id = ?)
  OR EXISTS (SELECT 1 FROM conversation_requests WHERE session_id = ? AND id = ? AND status = 'interrupted')`;

/** Geometry and opaque identities only, inside the existing protected database.
 * Every writer must first read its lease; a numeric version alone cannot cross a clear generation. */
export function createConversationReadingPositionStorage(
  database: SqlDatabase,
) {
  const artifacts = createConversationArtifactStorage(database);
  const leases = new Map<string, { version: number; generation: number }>();
  let ready: Promise<void> | undefined;
  const ensure = () =>
    (ready ??= (async () => {
      // Schema preparation must precede our transaction, never nest a global database operation.
      await artifacts.currentGeneration();
      await database.transaction(async tx => {
        await tx.execute(`CREATE TABLE IF NOT EXISTS conversation_reading_positions (
        session_id TEXT PRIMARY KEY NOT NULL, version INTEGER NOT NULL, generation INTEGER NOT NULL,
        turn_id TEXT NOT NULL, role TEXT NOT NULL, offset REAL NOT NULL, bottom INTEGER NOT NULL)`);
        await tx.execute(`CREATE TRIGGER IF NOT EXISTS conversation_reading_clear AFTER UPDATE OF generation ON conversation_artifact_generation
        BEGIN DELETE FROM conversation_reading_positions; END`);
        for (const event of ['DELETE', 'UPDATE']) {
          await tx.execute(`CREATE TRIGGER IF NOT EXISTS conversation_reading_session_${event.toLowerCase()} AFTER ${event} ON conversation_artifact_sessions
          BEGIN DELETE FROM conversation_reading_positions WHERE session_id = OLD.id; END`);
        }
        // Drop the anchor conservatively when any retained representation is removed.
        for (const [table, id] of [
          ['conversation_artifacts', 'id'],
          ['conversation_tool_events', 'message_id'],
          ['conversation_requests', 'id'],
        ]) {
          await tx.execute(`CREATE TRIGGER IF NOT EXISTS conversation_reading_${table}_removed AFTER DELETE ON ${table}
          BEGIN DELETE FROM conversation_reading_positions WHERE session_id = OLD.session_id AND turn_id = OLD.${id}; END`);
        }
      });
    })().catch(error => {
      ready = undefined;
      throw error;
    }));
  const assertCurrent = (current: () => boolean) => {
    if (!current()) throw new Error('Conversation reading position cancelled.');
  };
  return {
    async read(
      sessionId: string,
      current: () => boolean,
    ): Promise<{
      version: number;
      position: ConversationReadingPosition | null;
    } | null> {
      if (!validId(sessionId))
        throw new Error('Invalid conversation identity.');
      assertCurrent(current);
      await ensure();
      let result: {
        version: number;
        position: ConversationReadingPosition | null;
      } | null = null;
      let lease: { version: number; generation: number } | undefined;
      await database.transaction(async tx => {
        assertCurrent(current);
        const row = (
          await tx.execute(
            `SELECT s.version, s.generation FROM conversation_artifact_sessions s
          JOIN conversation_artifact_generation g ON g.singleton = 1 AND s.generation = g.generation
          WHERE s.id = ? AND s.hidden = 0`,
            [sessionId],
          )
        ).rows[0];
        if (!row) return;
        const { version, generation } = row;
        if (
          typeof version !== 'number' ||
          !Number.isSafeInteger(version) ||
          version < 0 ||
          typeof generation !== 'number' ||
          !Number.isSafeInteger(generation) ||
          generation < 0
        )
          throw new Error('Invalid conversation lease.');
        lease = { version, generation };
        const saved = (
          await tx.execute(
            'SELECT * FROM conversation_reading_positions WHERE session_id = ? AND version = ? AND generation = ?',
            [sessionId, version, generation],
          )
        ).rows[0];
        let position: ConversationReadingPosition | null = null;
        if (saved) {
          const candidate = {
            turnId: saved.turn_id,
            role: saved.role,
            offset: saved.offset,
            bottom: saved.bottom === 1,
          } as ConversationReadingPosition;
          if (
            validPosition(candidate) &&
            (saved.bottom === 0 || saved.bottom === 1)
          ) {
            const target = await tx.execute(
              `SELECT 1 AS found WHERE ${targetExists}`,
              Array(3).fill([sessionId, candidate.turnId]).flat(),
            );
            if (target.rows.length) position = candidate;
          }
        }
        assertCurrent(current);
        result = { version, position };
      });
      assertCurrent(current);
      if (lease) leases.set(sessionId, lease);
      else leases.delete(sessionId);
      return result;
    },
    async write(
      sessionId: string,
      version: number,
      position: ConversationReadingPosition,
      current: () => boolean,
    ) {
      if (!validId(sessionId) || !validPosition(position))
        throw new Error('Invalid conversation reading position.');
      const lease = leases.get(sessionId);
      if (!lease || lease.version !== version)
        throw new Error('Conversation reading lease is unavailable.');
      assertCurrent(current);
      await ensure();
      await database.transaction(async tx => {
        assertCurrent(current);
        // Statement-time predicates also fence raw same-connection mutation between awaits.
        await tx.execute(
          `INSERT OR REPLACE INTO conversation_reading_positions
          SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (
            SELECT 1 FROM conversation_artifact_sessions s JOIN conversation_artifact_generation g
            ON g.singleton = 1 AND s.generation = g.generation
            WHERE s.id = ? AND s.hidden = 0 AND s.version = ? AND s.generation = ?)
          AND (${targetExists})`,
          [
            sessionId,
            version,
            lease.generation,
            position.turnId,
            position.role,
            position.offset,
            position.bottom ? 1 : 0,
            sessionId,
            version,
            lease.generation,
            ...Array(3).fill([sessionId, position.turnId]).flat(),
          ],
        );
        assertCurrent(current);
      });
    },
  };
}
