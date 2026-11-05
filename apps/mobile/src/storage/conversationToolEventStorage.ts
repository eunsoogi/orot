import type { SqlDatabase } from '@orot/storage';
import {
  mergeConversationToolEvents,
  projectConversationToolEvent,
  type ConversationToolEvent,
} from '@orot/agent-runtime';

export interface StoredConversationToolTurn {
  readonly messageId: string;
  readonly createdAt: string;
  readonly toolEvents: readonly ConversationToolEvent[];
}

// Several feature adapters may open the same live connection. Only a new connection is a restart.
const recoveries = new WeakMap<SqlDatabase, Promise<void>>();

/** Tool calls share the encrypted conversation session lease and deletion lifecycle. */
export function createConversationToolEventStorage(
  database: SqlDatabase,
  ensure: () => Promise<void>,
) {
  return {
    async appendToolEvent(input: {
      sessionId: string;
      messageId: string;
      createdAt: string;
      sessionVersion: number;
      event: ConversationToolEvent;
    }) {
      const event = projectConversationToolEvent(input.event);
      if (
        !event ||
        !input.messageId ||
        input.messageId.length > 200 ||
        !Number.isFinite(Date.parse(input.createdAt)) ||
        new Date(input.createdAt).toISOString() !== input.createdAt
      )
        throw new Error('Invalid conversation tool identity.');
      await ensure();
      await database.transaction(async tx => {
        const session = await tx.execute(
          'SELECT s.id FROM conversation_artifact_sessions s JOIN conversation_artifact_generation g ON g.singleton = 1 AND s.generation = g.generation WHERE s.id = ? AND s.hidden = 0 AND s.version = ?',
          [input.sessionId, input.sessionVersion],
        );
        if (!session.rows.length)
          throw new Error('Conversation is unavailable.');
        const prior = await tx.execute(
          'SELECT message_id, created_at, event_json FROM conversation_tool_events WHERE session_id = ? AND run_id = ? AND call_id = ?',
          [input.sessionId, event.operationRunId, event.callId],
        );
        const row = prior.rows[0];
        if (
          row &&
          (row.message_id !== input.messageId ||
            row.created_at !== input.createdAt)
        )
          throw new Error('Tool call belongs to a different message.');
        const old = row
          ? projectConversationToolEvent(JSON.parse(String(row.event_json)))
          : null;
        if (row && !old) throw new Error('Stored tool event is invalid.');
        const merged = mergeConversationToolEvents(old ? [old] : [], event)[0]!;
        await tx.execute(
          'INSERT OR REPLACE INTO conversation_tool_events (session_id, message_id, created_at, run_id, call_id, event_json) VALUES (?, ?, ?, ?, ?, ?)',
          [
            input.sessionId,
            input.messageId,
            input.createdAt,
            event.operationRunId,
            event.callId,
            JSON.stringify(merged),
          ],
        );
      });
    },
    /** Call once at application storage startup, before any new request can begin. */
    async recoverInterruptedToolEvents() {
      await ensure();
      let recovery = recoveries.get(database);
      if (!recovery) {
        recovery = database
          .transaction(async tx => {
            await tx.execute(
              "UPDATE conversation_tool_events SET event_json = json_set(event_json, '$.status', 'interrupted') WHERE json_extract(event_json, '$.status') = 'started'",
            );
          })
          .catch(error => {
            recoveries.delete(database);
            throw error;
          });
        recoveries.set(database, recovery);
      }
      await recovery;
    },
    async readToolTurns(
      sessionId: string,
    ): Promise<readonly StoredConversationToolTurn[]> {
      await ensure();
      const result = await database.execute(
        'SELECT e.message_id, e.created_at, e.event_json FROM conversation_tool_events e JOIN conversation_artifact_sessions s ON s.id = e.session_id AND s.hidden = 0 JOIN conversation_artifact_generation g ON g.singleton = 1 AND s.generation = g.generation WHERE e.session_id = ? ORDER BY e.created_at, e.message_id, e.run_id, e.call_id',
        [sessionId],
      );
      const turns = new Map<string, StoredConversationToolTurn>();
      for (const row of result.rows) {
        const event = projectConversationToolEvent(
          JSON.parse(String(row.event_json)),
        );
        if (!event) throw new Error('Stored tool event is invalid.');
        const messageId = String(row.message_id);
        const prior = turns.get(messageId);
        turns.set(messageId, {
          messageId,
          createdAt: String(row.created_at),
          toolEvents: mergeConversationToolEvents(
            prior?.toolEvents ?? [],
            event,
          ),
        });
      }
      return [...turns.values()];
    },
  };
}
