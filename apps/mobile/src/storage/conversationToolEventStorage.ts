import type { SqlDatabase } from '@orot/storage';
import {
  mergeConversationToolEvents,
  projectConversationToolEvent,
  type ConversationToolEvent,
} from '@orot/agent-runtime';
import { assertConversationArtifactCurrent } from './conversationArtifactFreshness';
import {
  decodeToolLineage,
  indexToolLineage,
  type ToolLineage,
} from './conversationToolLineage';

export interface StoredConversationToolTurn {
  readonly messageId: string;
  readonly createdAt: string;
  readonly toolEvents: readonly ConversationToolEvent[];
  readonly lineages: readonly {
    readonly runId: string;
    readonly callId: string;
    readonly sources: ToolLineage;
  }[];
}

// Several feature adapters may open the same live connection. Only a new connection is a restart.
const recoveries = new WeakMap<SqlDatabase, Promise<void>>();

/** Tool calls share the encrypted conversation session lease and deletion lifecycle. */
export function createConversationToolEventStorage(
  database: SqlDatabase,
  ensure: () => Promise<void>,
) {
  return {
    /** A source that cannot be retained must not leave a permanently running call. */
    async discardToolEvent(input: {
      sessionId: string;
      messageId: string;
      sessionVersion: number;
      operationRunId: string;
      callId: string;
    }) {
      await ensure();
      await database.transaction(async tx => {
        const session = await tx.execute(
          'SELECT s.id FROM conversation_artifact_sessions s JOIN conversation_artifact_generation g ON g.singleton = 1 AND s.generation = g.generation WHERE s.id = ? AND s.hidden = 0 AND s.version = ?',
          [input.sessionId, input.sessionVersion],
        );
        if (!session.rows.length)
          throw new Error('Conversation is unavailable.');
        const call = await tx.execute(
          'SELECT message_id FROM conversation_tool_events WHERE session_id = ? AND run_id = ? AND call_id = ?',
          [input.sessionId, input.operationRunId, input.callId],
        );
        if (call.rows.length && call.rows[0]?.message_id !== input.messageId)
          throw new Error('Tool call belongs to a different message.');
        await tx.execute(
          'DELETE FROM conversation_tool_events WHERE session_id = ? AND message_id = ? AND run_id = ? AND call_id = ?',
          [
            input.sessionId,
            input.messageId,
            input.operationRunId,
            input.callId,
          ],
        );
        await tx.execute(
          'INSERT OR IGNORE INTO conversation_tool_removed_calls VALUES (?, ?, ?)',
          [input.sessionId, input.operationRunId, input.callId],
        );
      });
    },
    async appendToolEvent(input: {
      sessionId: string;
      messageId: string;
      createdAt: string;
      sessionVersion: number;
      event: ConversationToolEvent;
      dependencies?: ToolLineage;
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
      const lineage = decodeToolLineage(input.dependencies ?? [], event, input);
      await database.transaction(async tx => {
        // A late callback must not recreate events after a retained turn was removed.
        const session = await tx.execute(
          'SELECT s.id FROM conversation_artifact_sessions s JOIN conversation_artifact_generation g ON g.singleton = 1 AND s.generation = g.generation WHERE s.id = ? AND s.hidden = 0 AND s.version = ? AND NOT EXISTS (SELECT 1 FROM conversation_deleted_artifacts d WHERE d.id = ?) AND NOT EXISTS (SELECT 1 FROM conversation_tool_removed_calls r WHERE r.session_id = s.id AND r.run_id = ? AND r.call_id = ?)',
          [
            input.sessionId,
            input.sessionVersion,
            input.messageId,
            event.operationRunId,
            event.callId,
          ],
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
        // Validate the exact source revisions under the same lease as the event write.
        if (!old || (old.status === 'started' && event.status !== 'started'))
          await assertConversationArtifactCurrent(tx, database, lineage, true);
        await tx.execute(
          'INSERT INTO conversation_tool_events (session_id, message_id, created_at, run_id, call_id, event_json) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (session_id, run_id, call_id) DO UPDATE SET event_json = excluded.event_json',
          [
            input.sessionId,
            input.messageId,
            input.createdAt,
            event.operationRunId,
            event.callId,
            JSON.stringify(merged),
          ],
        );
        if (!old || (old.status === 'started' && event.status !== 'started'))
          await tx.execute(
            'INSERT OR REPLACE INTO conversation_tool_lineage (session_id, run_id, call_id, sources_json) VALUES (?, ?, ?, ?)',
            [
              input.sessionId,
              event.operationRunId,
              event.callId,
              JSON.stringify(lineage.sources),
            ],
          );
        if (!old || (old.status === 'started' && event.status !== 'started'))
          await indexToolLineage(tx, input.sessionId, event, lineage.sources);
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
      expectedVersion?: number,
    ): Promise<readonly StoredConversationToolTurn[]> {
      await ensure();
      const turns = new Map<string, StoredConversationToolTurn>();
      await database.transaction(async tx => {
        // An empty event list must still prove that the session lease is live.
        if (expectedVersion !== undefined) {
          const lease = await tx.execute(
            'SELECT s.id FROM conversation_artifact_sessions s JOIN conversation_artifact_generation g ON g.singleton = 1 AND s.generation = g.generation WHERE s.id = ? AND s.hidden = 0 AND s.version = ?',
            [sessionId, expectedVersion],
          );
          if (!lease.rows.length)
            throw new Error('Conversation is unavailable.');
        }
        const result = await tx.execute(
          'SELECT e.message_id, e.created_at, e.event_json, l.sources_json FROM conversation_tool_events e JOIN conversation_artifact_sessions s ON s.id = e.session_id AND s.hidden = 0 JOIN conversation_artifact_generation g ON g.singleton = 1 AND s.generation = g.generation LEFT JOIN conversation_tool_lineage l ON l.session_id = e.session_id AND l.run_id = e.run_id AND l.call_id = e.call_id WHERE e.session_id = ? ORDER BY e.created_at, e.message_id, e.run_id, e.call_id',
          [sessionId],
        );
        for (const row of result.rows) {
          const event = projectConversationToolEvent(
            JSON.parse(String(row.event_json)),
          );
          if (!event) throw new Error('Stored tool event is invalid.');
          const lineage = decodeToolLineage(
            row.sources_json ? JSON.parse(String(row.sources_json)) : [],
            event,
            {
              messageId: String(row.message_id),
              sessionId,
              createdAt: String(row.created_at),
            },
          );
          await assertConversationArtifactCurrent(tx, database, lineage, false);
          const messageId = String(row.message_id);
          const prior = turns.get(messageId);
          turns.set(messageId, {
            messageId,
            createdAt: String(row.created_at),
            toolEvents: mergeConversationToolEvents(
              prior?.toolEvents ?? [],
              event,
            ),
            lineages: [
              ...(prior?.lineages ?? []),
              {
                runId: event.operationRunId,
                callId: event.callId,
                sources: lineage.sources,
              },
            ],
          });
        }
      });
      return [...turns.values()];
    },
  };
}
