import type { SqlDatabase } from '@orot/storage';
import type { ConversationHistoryCursor } from '../ragConversation/conversationHistoryPage';
import { decodeConversationArtifact } from './conversationArtifactCodec';
import type { conversationTimelinePages } from './conversationTimelinePages';

export type PlainConversationContextResult =
  | { readonly status: 'fallback' }
  | {
      readonly status: 'plain';
      readonly turns: readonly {
        readonly id: string;
        readonly question: string;
      }[];
      readonly nextCursor: ConversationHistoryCursor | null;
    };
const fallback = { status: 'fallback' } as const;

/** Read already saved identities and authored question text, not display projections.
 * A page is eligible only when every entry is a complete ordinary turn with no
 * saved lineage or specialized UI semantics. Unsupported pages remain on the
 * existing guarded path; no missing row can turn into a shorter model prompt. */
export function createPlainConversationContextReader(
  database: SqlDatabase,
  listTimeline: ReturnType<typeof conversationTimelinePages>,
) {
  return async (
    sessionId: string,
    version: number,
    signal: AbortSignal,
    cursor?: ConversationHistoryCursor,
  ): Promise<PlainConversationContextResult> => {
    const assertActive = () => {
      if (signal.aborted)
        throw new Error('Conversation context was cancelled.');
    };
    assertActive();
    const before = await listTimeline(sessionId, version, cursor);
    assertActive();
    if (before.items.some(item => item.kind !== 'turn')) return fallback;
    const ids = before.items.map(item => item.id);
    let turns: { id: string; question: string }[] | undefined;
    if (ids.length)
      await database.transaction(async tx => {
        const result = await tx.execute(
          `SELECT a.id, a.session_id, a.created_at, a.result_json
         FROM conversation_artifacts a
         JOIN conversation_artifact_sessions s ON s.id=a.session_id
           AND s.hidden=0 AND s.version=?
         JOIN conversation_artifact_generation g ON g.singleton=1 AND s.generation=g.generation
         JOIN json_each(?) selected ON a.id=selected.value
         WHERE a.session_id=?
           AND NOT EXISTS (SELECT 1 FROM conversation_artifact_removed_sessions d WHERE d.id=s.id)
           AND NOT EXISTS (SELECT 1 FROM conversation_deleted_artifacts d WHERE d.id=a.id)
           AND NOT EXISTS (SELECT 1 FROM conversation_invalid_parents p WHERE p.id=a.id)
           AND NOT EXISTS (SELECT 1 FROM conversation_tool_events x WHERE x.session_id=s.id AND x.message_id=a.id)
           AND NOT EXISTS (SELECT 1 FROM conversation_requests r WHERE r.session_id=s.id AND r.id=a.id
             AND (r.status <> 'completed' OR r.input_json IS NOT NULL))`,
          [version, JSON.stringify(ids), sessionId],
        );
        assertActive();
        if (result.rows.length !== ids.length) return;
        const rows = new Map(result.rows.map(row => [row.id, row]));
        const admitted: { id: string; question: string }[] = [];
        for (const item of [...before.items].reverse()) {
          const row = rows.get(item.id);
          const body = decodeConversationArtifact(row?.result_json);
          if (
            !body ||
            body.id !== item.id ||
            body.sessionId !== sessionId ||
            row?.session_id !== sessionId ||
            row.created_at !== body.createdAt ||
            body.createdAt !== item.createdAt ||
            body.status !== 'complete' ||
            !body.question ||
            body.sources.length ||
            body.citations?.length !== 0 ||
            body.submittedInput ||
            body.treatmentContext ||
            body.healthSummary ||
            body.visitQuestions ||
            body.dailyReport ||
            body.entryIntent ||
            body.priorDialogue ||
            body.priorUserReports ||
            body.priorDialogueOmitted ||
            body.initialResponse
          )
            return;
          admitted.push({ id: item.id, question: body.question });
        }
        turns = admitted;
      });
    else turns = [];
    assertActive();
    if (!turns) return fallback;
    const after = await listTimeline(sessionId, version, cursor);
    assertActive();
    if (JSON.stringify(after) !== JSON.stringify(before))
      throw new Error('Conversation context changed while selecting turns.');
    return { status: 'plain', turns, nextCursor: before.nextCursor };
  };
}
