import type { SqlExecutor } from '@orot/storage';

export interface OrdinaryConversationCompletionIdentity {
  readonly requestId: string;
  readonly sessionId: string;
  readonly sessionVersion: number;
  readonly question: string;
  readonly replyPreferenceSpan?: string;
  readonly authoredRoutineSpan?: string;
  readonly createdAt: string;
  /** Only the live composer owner can attach its exact retained entry mode. */
  readonly entryIntent?: 'possibilities';
}

/** This read is a protected, same-transaction gate for an optional local note.
 * The caller must separately prove live composer admission and consent. No
 * answer text, evidence read or older conversation is returned to the caller. */
export async function hasOrdinaryConversationCompletedSource(
  tx: SqlExecutor,
  identity: OrdinaryConversationCompletionIdentity,
): Promise<boolean> {
  const result = await tx.execute(
    `SELECT 1 AS matched
     FROM conversation_requests r
     JOIN conversation_completions c
       ON c.request_id = r.id AND c.session_id = r.session_id AND c.message_id = r.id
     JOIN conversation_artifacts a
       ON a.id = c.message_id AND a.session_id = c.session_id AND a.created_at = r.created_at
     JOIN conversation_artifact_sessions s ON s.id = r.session_id
     JOIN conversation_artifact_generation g ON g.singleton = 1 AND s.generation = g.generation
     WHERE r.id = ? AND r.session_id = ? AND r.session_version = ?
       AND r.question = ? COLLATE BINARY AND r.created_at = ?
       AND r.status = 'completed' AND r.input_json IS NULL AND r.interruption_reason IS NULL
       AND s.hidden = 0 AND s.version = r.session_version
       AND NOT EXISTS (SELECT 1 FROM conversation_artifact_removed_sessions WHERE id = s.id)
       AND NOT EXISTS (SELECT 1 FROM conversation_deleted_artifacts WHERE id = a.id)
       AND CASE WHEN json_valid(a.result_json) THEN (
         json_extract(a.result_json, '$.id') = a.id
         AND json_extract(a.result_json, '$.sessionId') = a.session_id
         AND json_extract(a.result_json, '$.createdAt') = a.created_at
         AND json_extract(a.result_json, '$.question') = r.question COLLATE BINARY
         AND json_extract(a.result_json, '$.status') = 'complete'
         AND json_type(a.result_json, '$.submittedInput') IS NULL
         AND (
           (?6 IS NULL AND json_type(a.result_json, '$.entryIntent') IS NULL)
           OR (?6 = 'possibilities' AND json_type(a.result_json, '$.entryIntent') = 'text'
             AND json_extract(a.result_json, '$.entryIntent') = ?6 COLLATE BINARY)
         )
         AND json_type(a.result_json, '$.dailyReport') IS NULL
         AND json_type(a.result_json, '$.healthSummary') IS NULL
         AND json_type(a.result_json, '$.visitQuestions') IS NULL
         AND json_type(a.result_json, '$.treatmentContext') IS NULL
       ) ELSE 0 END
     LIMIT 1`,
    [
      identity.requestId,
      identity.sessionId,
      identity.sessionVersion,
      identity.question,
      identity.createdAt,
      identity.entryIntent ?? null,
    ],
  );
  return result.rows[0]?.matched === 1;
}
