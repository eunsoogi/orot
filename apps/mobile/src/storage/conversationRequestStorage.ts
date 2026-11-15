import {
  decodeConversationRecoveryReason,
  type ConversationRecoveryReason,
} from '../ragConversation/conversationExecutionLease';
import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import type { ConversationArtifact } from './conversationArtifactCodec';
import {
  decodeConversationSubmittedInput,
  type ConversationSubmittedInput,
} from '../ragConversation/conversationSubmittedInput';
import { stableJson } from '../aiFeatures/integration/evidenceUtils';
import { createConversationRequestSources } from './conversationRequestSources';
import { createConversationRequestReader } from './conversationRequestRead';

// Multiple adapters may share one connection; reopening an adapter is not a process restart.
const recoveries = new WeakMap<SqlDatabase, Promise<void>>();

/** Called inside the answer transaction so a completion never precedes its saved answer. */
export async function commitConversationRequest(
  tx: SqlExecutor,
  value: ConversationArtifact,
  version: number,
  alreadyStored = false,
) {
  const result = await tx.execute(
    'SELECT session_id, session_version, question, created_at, status, input_json FROM conversation_requests WHERE id = ?',
    [value.id],
  );
  const row = result.rows[0];
  if (!row) {
    // Legacy turns have no checkpoint; an identity fence instead denotes removed work.
    const identity = await tx.execute(
      'SELECT id FROM conversation_request_identities WHERE id = ?',
      [value.id],
    );
    if (identity.rows.length)
      throw new Error('Conversation request is no longer active.');
    return;
  }
  if (
    row.session_id !== value.sessionId ||
    row.session_version !== version ||
    row.question !== value.question ||
    row.created_at !== value.createdAt ||
    (row.input_json === null
      ? value.submittedInput !== undefined
      : typeof row.input_json !== 'string' ||
        !value.submittedInput ||
        stableJson(value.submittedInput) !== row.input_json) ||
    !(
      row.status === 'active' ||
      row.status === 'completed' ||
      (alreadyStored &&
        value.status === 'partial' &&
        row.status === 'interrupted')
    )
  )
    throw new Error('Conversation request is no longer active.');
  // Only a byte-identical retained partial can be retried after interruption.
  if (row.status === 'interrupted') return;
  if (value.status !== 'complete') {
    await tx.execute(
      "UPDATE conversation_requests SET status = 'interrupted' WHERE id = ? AND status = 'active'",
      [value.id],
    );
    return;
  }
  await tx.execute(
    "UPDATE conversation_requests SET status = 'completed' WHERE id = ? AND status = 'active'",
    [value.id],
  );
  await tx.execute(
    'INSERT OR IGNORE INTO conversation_completions (request_id, session_id, message_id) VALUES (?, ?, ?)',
    [value.id, value.sessionId, value.id],
  );
}

/** Text-only checkpoint: attachment and transmitted OCR references require a separate input contract.
 * Checkpoints cannot resurrect a hidden, removed, or replaced session lease.
 */
export function createConversationRequestStorage(
  database: SqlDatabase,
  ensure: () => Promise<void>,
) {
  return {
    ...createConversationRequestSources(database, ensure),
    ...createConversationRequestReader(database, ensure),
    async startRequest(input: {
      id: string;
      sessionId: string;
      sessionVersion: number;
      question: string;
      createdAt: string;
      submittedInput?: ConversationSubmittedInput;
    }) {
      const { id, sessionId, sessionVersion, question, createdAt } = input;
      let submitted: ConversationSubmittedInput | null | undefined;
      if (input.submittedInput !== undefined) {
        try {
          submitted = decodeConversationSubmittedInput(
            JSON.parse(JSON.stringify(input.submittedInput)),
          );
        } catch {
          throw new Error('Invalid conversation request.');
        }
      }
      if (
        typeof id !== 'string' ||
        !id ||
        id.length > 200 ||
        typeof sessionId !== 'string' ||
        !sessionId ||
        sessionId.length > 200 ||
        !Number.isSafeInteger(sessionVersion) ||
        sessionVersion < 0 ||
        typeof question !== 'string' ||
        (!question && !submitted?.ocr) ||
        question.length > 1000 ||
        (input.submittedInput !== undefined && !submitted) ||
        (submitted &&
          (submitted.sessionId !== sessionId ||
            submitted.requestId !== id ||
            submitted.question !== question)) ||
        typeof createdAt !== 'string' ||
        !Number.isFinite(Date.parse(createdAt)) ||
        new Date(createdAt).toISOString() !== createdAt
      )
        throw new Error('Invalid conversation request.');
      await ensure();
      await database.transaction(async tx => {
        const session = await tx.execute(
          'SELECT s.id FROM conversation_artifact_sessions s JOIN conversation_artifact_generation g ON g.singleton = 1 AND s.generation = g.generation WHERE s.id = ? AND s.hidden = 0 AND s.version = ?',
          [sessionId, sessionVersion],
        );
        if (!session.rows.length)
          throw new Error('Conversation is unavailable.');
        if (submitted?.ocr) {
          const removed = await tx.execute(
            'SELECT id FROM conversation_request_removed_sources WHERE id = ?',
            [submitted.ocr.source.id],
          );
          if (removed.rows.length)
            throw new Error('Conversation attachment is unavailable.');
        }
        // A turn identity already associated with an answer or its tombstone cannot be repurposed.
        const occupied = await tx.execute(
          'SELECT id FROM conversation_artifacts WHERE id = ? UNION ALL SELECT id FROM conversation_deleted_artifacts WHERE id = ? UNION ALL SELECT message_id FROM conversation_tool_events WHERE message_id = ? LIMIT 1',
          [id, id, id],
        );
        if (occupied.rows.length)
          throw new Error('Conversation request identity is unavailable.');
        await tx.execute(
          'INSERT INTO conversation_request_identities (id) VALUES (?)',
          [id],
        );
        await tx.execute(
          'INSERT INTO conversation_requests (id, session_id, session_version, question, created_at, status, input_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [
            id,
            sessionId,
            sessionVersion,
            question,
            createdAt,
            'active',
            submitted ? stableJson(submitted) : null,
          ],
        );
        if (submitted?.ocr)
          await tx.execute(
            'INSERT INTO conversation_request_sources (request_id, source_id) VALUES (?, ?)',
            [id, submitted.ocr.source.id],
          );
      });
    },
    async interruptRequest(
      id: string,
      sessionId: string,
      version: number,
      status: 'interrupted' | 'cancelled',
      reason?: ConversationRecoveryReason,
    ) {
      if (reason !== undefined && !decodeConversationRecoveryReason(reason))
        throw new Error('Invalid interruption reason.');
      await ensure();
      // Explicit Stop/abandon also fences a safely paused request. Automatic late
      // failures must not replace the saved pause reason or the user's stop intent.
      await database.execute(
        "UPDATE conversation_requests SET interruption_reason = ?, status = ?, question = CASE WHEN ? = 'cancelled' THEN '' ELSE question END, input_json = CASE WHEN ? = 'cancelled' THEN NULL ELSE input_json END WHERE id = ? AND session_id = ? AND session_version = ? AND (status = 'active' OR (status = 'interrupted' AND (? = 'cancelled' OR ? = 'user-stopped')))",
        [
          status === 'cancelled' ? null : (reason ?? null),
          status,
          status,
          status,
          id,
          sessionId,
          version,
          status,
          reason ?? null,
        ],
      );
    },
    /** Call once on app startup before a new request starts; no provider is resubmitted. */
    async interruptRecoveredRequests() {
      let recovery = recoveries.get(database);
      if (!recovery) {
        recovery = ensure()
          .then(async () => {
            await database.execute(
              "UPDATE conversation_requests SET status = 'interrupted', interruption_reason = 'process-interrupted' WHERE status = 'active'",
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
  };
}
