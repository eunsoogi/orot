import { decodeConversationRecoveryReason } from '../ragConversation/conversationExecutionLease';
import type { SqlDatabase } from '@orot/storage';
import {
  decodeConversationSubmittedInput,
  type ConversationSubmittedInput,
} from '../ragConversation/conversationSubmittedInput';

/** Read only current session leases; consumers must separately validate native originals. */
export function createConversationRequestReader(
  database: SqlDatabase,
  ensure: () => Promise<void>,
) {
  return {
    async listInterruptedRequests(sessionId: string, version: number) {
      await ensure();
      const result = await database.execute(
        "SELECT r.id, r.question, r.created_at, r.input_json, r.interruption_reason FROM conversation_requests r JOIN conversation_artifact_sessions s ON s.id = r.session_id AND s.hidden = 0 AND s.version = r.session_version JOIN conversation_artifact_generation g ON g.singleton = 1 AND g.generation = s.generation WHERE r.session_id = ? AND r.session_version = ? AND r.status = 'interrupted' ORDER BY r.created_at, r.id",
        [sessionId, version],
      );
      return result.rows.map(row => {
        if (
          typeof row.id !== 'string' ||
          typeof row.question !== 'string' ||
          typeof row.created_at !== 'string' ||
          !Number.isFinite(Date.parse(row.created_at))
        )
          throw new Error('Invalid conversation request state.');
        let submittedInput: ConversationSubmittedInput | undefined;
        if (row.input_json !== null) {
          if (typeof row.input_json !== 'string')
            throw new Error('Invalid conversation request state.');
          let value: unknown;
          try {
            value = JSON.parse(row.input_json);
          } catch {
            throw new Error('Invalid conversation request state.');
          }
          const decoded = decodeConversationSubmittedInput(value);
          if (
            !decoded ||
            decoded.requestId !== row.id ||
            decoded.sessionId !== sessionId ||
            decoded.question !== row.question
          )
            throw new Error('Invalid conversation request state.');
          submittedInput = decoded;
        }
        return {
          id: row.id,
          ...(decodeConversationRecoveryReason(row.interruption_reason)
            ? {
                interruptionReason: decodeConversationRecoveryReason(
                  row.interruption_reason,
                ),
              }
            : {}),
          question: row.question,
          createdAt: row.created_at,
          ...(submittedInput ? { submittedInput } : {}),
        };
      });
    },
    /** Consumers must resolve the answer through freshness-checked readers before delivery. */
    async listCompletionIdentities() {
      await ensure();
      const result = await database.execute(
        "SELECT c.request_id, c.session_id, c.message_id, s.version FROM conversation_completions c JOIN conversation_artifacts a ON a.id = c.message_id AND a.session_id = c.session_id JOIN conversation_artifact_sessions s ON s.id = c.session_id AND s.hidden = 0 JOIN conversation_requests r ON r.id = c.request_id AND r.session_id = c.session_id AND r.session_version = s.version AND r.status = 'completed' JOIN conversation_artifact_generation g ON g.singleton = 1 AND g.generation = s.generation ORDER BY a.created_at, a.id",
      );
      return result.rows.map(row => {
        if (
          typeof row.request_id !== 'string' ||
          typeof row.session_id !== 'string' ||
          typeof row.message_id !== 'string' ||
          typeof row.version !== 'number' ||
          !Number.isSafeInteger(row.version) ||
          row.version < 0
        )
          throw new Error('Invalid conversation completion state.');
        return {
          requestId: row.request_id,
          sessionId: row.session_id,
          messageId: row.message_id,
          sessionVersion: row.version,
          status: 'completed' as const,
        };
      });
    },
  };
}
