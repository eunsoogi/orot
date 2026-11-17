import type { SqlDatabase } from '@orot/storage';
import {
  mergeConversationToolEvents,
  projectConversationToolEvent,
} from '@orot/agent-runtime';
import { conversationSelectedIds } from './conversationSelectedIds';
import {
  assertToolLineage,
  decodeToolLineage,
  indexToolLineage,
} from './conversationToolLineage';
import { legacyToolPeriodAvailable } from './legacyToolPeriodQuarantine';
import { RetainedSourceInvalidError } from '../aiFeatures/integration/retainedSourceError';
import type { StoredConversationToolTurn } from './conversationToolEventStorage';

/** Snapshot unavailable source state without turning a recoverable read failure into a durable policy. */
export function conversationToolSnapshotReader(
  database: SqlDatabase,
  ensure: () => Promise<void>,
) {
  return async (
    sessionId: string,
    expectedVersion?: number,
    selectedIds?: readonly string[],
    strictSources = false,
  ) => {
    await ensure();
    const selected = conversationSelectedIds('e.message_id', selectedIds);
    const turns = new Map<string, StoredConversationToolTurn>();
    const unavailable: {
      messageId: string;
      createdAt: string;
      reason: 'source_unavailable' | 'unverifiable_legacy_period';
    }[] = [];
    await database.transaction(async tx => {
      // An empty event list must still prove that the session lease is live.
      if (expectedVersion !== undefined) {
        const lease = await tx.execute(
          'SELECT s.id FROM conversation_artifact_sessions s JOIN conversation_artifact_generation g ON g.singleton = 1 AND s.generation = g.generation WHERE s.id = ? AND s.hidden = 0 AND s.version = ?',
          [sessionId, expectedVersion],
        );
        if (!lease.rows.length) throw new Error('Conversation is unavailable.');
      }
      const result = await tx.execute(
        `SELECT e.message_id, e.created_at, e.event_json, l.sources_json FROM conversation_tool_events e JOIN conversation_artifact_sessions s ON s.id = e.session_id AND s.hidden = 0 JOIN conversation_artifact_generation g ON g.singleton = 1 AND s.generation = g.generation LEFT JOIN conversation_tool_lineage l ON l.session_id = e.session_id AND l.run_id = e.run_id AND l.call_id = e.call_id WHERE e.session_id = ?${selected.clause} ORDER BY e.created_at, e.message_id, e.run_id, e.call_id`,
        [sessionId, ...selected.parameters],
      );
      const candidates: {
        row: (typeof result.rows)[number];
        event: NonNullable<ReturnType<typeof projectConversationToolEvent>>;
        lineage: ReturnType<typeof decodeToolLineage>;
      }[] = [];
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
        await indexToolLineage(tx, sessionId, event, lineage.sources);
        if (
          !(await legacyToolPeriodAvailable(
            tx,
            [sessionId, event.operationRunId, event.callId],
            lineage.sources,
          ))
        ) {
          unavailable.push({
            messageId: String(row.message_id),
            createdAt: String(row.created_at),
            reason: 'unverifiable_legacy_period',
          });
          continue;
        }
        candidates.push({ row, event, lineage });
      }
      // History-only tool notices remain ephemeral, but existing exact-parent memory audit
      // decisions commit just as in artifact/memory reads. Do not suppress that established policy.
      // Strict callers still throw the original error and roll back the outer transaction.
      for (const { row, event, lineage } of candidates) {
        try {
          await assertToolLineage(tx, database, lineage, false);
        } catch (error) {
          if (strictSources || !(error instanceof RetainedSourceInvalidError))
            throw error;
          unavailable.push({
            messageId: String(row.message_id),
            createdAt: String(row.created_at),
            reason: 'source_unavailable',
          });
          continue;
        }
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
    // One unavailable call withholds its whole turn; no sibling payload can leak via that notice.
    return {
      items: [...turns.values()].filter(
        turn => !unavailable.some(item => item.messageId === turn.messageId),
      ),
      unavailable,
    };
  };
}
