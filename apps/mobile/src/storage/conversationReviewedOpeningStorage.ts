import { contextualOpeningAuthoredProof } from '../ragConversation/contextualOpeningApproval';
import type { SqlDatabase } from '@orot/storage';
import { assertConversationNotCancelled } from './conversationArtifactCancellation';

export type ReviewedOpening = Readonly<{ callId: string; text: string }>;

function validOpening(
  value: Partial<ReviewedOpening>,
): value is ReviewedOpening {
  return (
    typeof value.callId === 'string' &&
    !!value.callId &&
    value.callId.length <= 200 &&
    typeof value.text === 'string' &&
    !!value.text.trim() &&
    value.text.length <= 300
  );
}

export function decodeReviewedOpening(
  raw: unknown,
): ReviewedOpening | undefined {
  if (typeof raw !== 'string') return;
  try {
    const value = JSON.parse(raw);
    if (
      (value?.kind !== 'reviewed-prompt-opening-v1' &&
        value?.kind !== 'reviewed-authored-local-opening-v2' &&
        value?.kind !== 'reviewed-authored-contextual-opening-v3') ||
      Object.keys(value).length !== 4 ||
      !Number.isSafeInteger(value.deletionEpoch) ||
      value.deletionEpoch < 0 ||
      !validOpening(value)
    )
      return;
    return { callId: value.callId, text: value.text };
  } catch {
    return;
  }
}

/** Only a completed, owned, positively attested authored-only opening can
 * survive an unrelated health deletion. V1 and interruptions use the existing
 * deletion epoch; an invalid present journal still blocks artifact fallback. */
export const currentReviewedOpeningSql = `CASE
  WHEN NOT json_valid(r.reviewed_opening_json) THEN NULL
  WHEN json_extract(r.reviewed_opening_json, '$.kind') IN ('reviewed-authored-local-opening-v2', 'reviewed-authored-contextual-opening-v3')
    AND r.status = 'completed' AND r.input_json IS NULL
    AND NOT EXISTS (SELECT 1 FROM conversation_request_sources opening_source WHERE opening_source.request_id = r.id)
  THEN r.reviewed_opening_json
  WHEN json_extract(r.reviewed_opening_json, '$.deletionEpoch') =
    (SELECT deletions FROM health_context_generation WHERE singleton = 1)
  THEN r.reviewed_opening_json END AS reviewed_opening_json,
  r.reviewed_opening_json IS NOT NULL AS has_reviewed_opening`;

/** A reviewed opening has only the exact user prompt lineage and never feeds model history.
 * Commit it on its eligible active checkpoint before display, independently of any final result. */
export function createReviewedOpeningStorage(
  database: SqlDatabase,
  ensure: () => Promise<void>,
) {
  return async (input: {
    id: string;
    sessionId: string;
    version: number;
    createdAt: string;
    opening: ReviewedOpening;
    current: () => boolean;
    signal: AbortSignal;
  }) => {
    const { id, sessionId, version, createdAt, signal, opening } = input;
    const authored = contextualOpeningAuthoredProof(opening);
    const authoredInput = authored?.input;
    const serialized = JSON.stringify({
      kind:
        authoredInput === undefined
          ? 'reviewed-prompt-opening-v1'
          : 'reviewed-authored-contextual-opening-v3',
      callId: opening.callId,
      text: opening.text,
    });
    if (!validOpening(opening))
      throw new Error('Invalid reviewed conversation opening.');
    const assertCurrent = () => {
      assertConversationNotCancelled(signal);
      if (
        !input.current() ||
        (authored &&
          (authored.requestId !== id ||
            authored.sessionId !== sessionId ||
            authored.sessionVersion !== version ||
            !authored.current()))
      )
        throw new Error('Conversation is unavailable.');
    };
    assertCurrent();
    await ensure();
    let committed = false;
    await database
      .transaction(async tx => {
        assertCurrent();
        const changed = await tx.execute(
          `UPDATE conversation_requests AS r SET reviewed_opening_json = json_set(?, '$.deletionEpoch',
           (SELECT deletions FROM health_context_generation WHERE singleton = 1))
         WHERE EXISTS (SELECT 1 FROM health_context_generation WHERE singleton = 1)
           AND r.id = ? AND r.session_id = ? AND r.session_version = ? AND r.created_at = ?
           AND r.status = 'active' AND r.input_json IS NULL AND r.reviewed_opening_json IS NULL
           AND (? IS NULL OR r.question = ?)
           AND EXISTS (SELECT 1 FROM conversation_artifact_sessions s
             JOIN conversation_artifact_generation g ON g.singleton = 1 AND s.generation = g.generation
             WHERE s.id = r.session_id AND s.version = r.session_version AND s.hidden = 0)
           AND NOT EXISTS (SELECT 1 FROM conversation_artifact_removed_sessions x WHERE x.id = r.session_id)
           AND NOT EXISTS (SELECT 1 FROM conversation_deleted_artifacts x WHERE x.id = r.id)
           AND NOT EXISTS (SELECT 1 FROM conversation_invalid_parents x WHERE x.id = r.id)
           AND NOT EXISTS (SELECT 1 FROM conversation_request_sources x WHERE x.request_id = r.id)`,
          [
            serialized,
            id,
            sessionId,
            version,
            createdAt,
            authoredInput ?? null,
            authoredInput ?? null,
          ],
        );
        if (changed.rowsAffected !== 1)
          throw new Error('Conversation is unavailable.');
        // The existing pinned driver commits synchronously. There is no await
        // after the final app owner proof and before that SQLite commit.
        assertCurrent();
        tx.commit();
        committed = true;
      })
      .catch(error => {
        if (!committed) throw error;
      });
  };
}
