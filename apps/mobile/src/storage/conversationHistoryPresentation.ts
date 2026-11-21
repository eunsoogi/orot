import { validConversationReportTarget } from './conversationReportTarget';
import type { ConversationArtifact } from './conversationArtifactTypes';
import { assertConversationSourcesNotRemoved } from './conversationArtifactDependencies';
import { selectArchivedCitation } from './selectArchivedCitation';
import { createProtectedPromptHistory } from './protectedPromptHistory';
import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import {
  projectSavedArchivedCitations,
  type SavedArchivedCitation,
} from '../ragConversation/savedArchivedCitations';
import {
  decodeConversationRecoveryReason,
  type ConversationRecoveryReason,
} from '../ragConversation/conversationExecutionLease';
import { suppressExplicitlyRemovedHistory } from './conversationHistoryDisplayAncestorFence';

/** Stored transcript, not a retained turn or source authorization. */
export type ConversationHistoryPresentation = {
  readonly id: string;
  readonly sessionId: string;
  readonly createdAt: string;
  readonly question: string;
  readonly interruptionReason?: ConversationRecoveryReason;
} & (
  | {
      readonly status: 'complete' | 'partial';
      readonly answer: string;
      readonly dailyReport?: NonNullable<ConversationArtifact['dailyReport']>;
      readonly savedCitations?: readonly SavedArchivedCitation[];
    }
  | { readonly status: 'interrupted'; readonly answer?: never }
);

function readArchivedText(serialized: unknown): Record<string, unknown> | null {
  if (typeof serialized !== 'string') return null;
  try {
    const value: unknown = JSON.parse(serialized);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Read verified-at-save text, not whether sources are still openable. The
 * artifact table is written by the existing protected, validating append.
 * Legacy complete answers predate request checkpoints; their durable artifact
 * is the commit. If a checkpoint exists, it must agree with the saved turn. An interruption
 * without a committed artifact can disclose the authored question, never preview text. */
function createOwnedArchiveReader<T>(
  database: SqlDatabase,
  ensure: () => Promise<void>,
  project: (
    id: string,
    value: Record<string, unknown> | undefined,
    row: ConversationHistoryPresentation,
  ) => T | null,
  authorize?: (tx: SqlExecutor, value: T) => Promise<void>,
) {
  return async (sessionId: string, version: number, ids: readonly string[]) => {
    if (
      !sessionId ||
      sessionId.length > 200 ||
      !Number.isSafeInteger(version) ||
      version < 0 ||
      ids.length > 50 ||
      ids.some(id => !id || id.length > 210)
    )
      throw new RangeError('Invalid conversation presentation request.');
    await ensure();
    const output: (T | null)[] = [];
    await database.transaction(async tx => {
      const lease = await tx.execute(
        `SELECT s.id FROM conversation_artifact_sessions s
         JOIN conversation_artifact_generation g ON g.singleton = 1 AND s.generation = g.generation
         WHERE s.id = ? AND s.hidden = 0 AND s.version = ?
         AND NOT EXISTS (SELECT 1 FROM conversation_artifact_removed_sessions x WHERE x.id = s.id)`,
        [sessionId, version],
      );
      if (!lease.rows.length) throw new Error('Conversation is unavailable.');
      if (!ids.length) return;
      const selected = JSON.stringify([...new Set(ids)]);
      const { rows } = await tx.execute(
        `SELECT a.id, a.created_at, a.result_json, r.id AS request_id,
          r.question AS checkpoint_question, r.status AS checkpoint_status,
          r.interruption_reason, c.request_id AS completion_id
         FROM conversation_artifacts a JOIN json_each(?) ids ON ids.value = a.id
         LEFT JOIN conversation_requests r ON r.id = a.id
         LEFT JOIN conversation_completions c ON c.request_id = a.id
         WHERE a.session_id = ?
         AND NOT EXISTS (SELECT 1 FROM conversation_deleted_artifacts x WHERE x.id = a.id)
         AND NOT EXISTS (SELECT 1 FROM conversation_invalid_parents x WHERE x.id = a.id)
         AND NOT EXISTS (
           SELECT 1 FROM conversation_request_sources x
           JOIN conversation_request_removed_sources m ON m.id = x.source_id
           WHERE x.request_id = a.id
         )
         AND (
           (r.id IS NULL AND c.request_id IS NULL AND NOT EXISTS (
             SELECT 1 FROM conversation_request_identities x WHERE x.id = a.id
           )) OR (
             r.session_id = a.session_id AND r.session_version = ?
             AND r.created_at = a.created_at
             AND ((r.status = 'completed' AND c.session_id = a.session_id AND c.message_id = a.id)
               OR (r.status = 'interrupted' AND c.request_id IS NULL))
           )
         )
         UNION ALL
         SELECT r.id, r.created_at, NULL, r.id, r.question, r.status,
           r.interruption_reason, NULL
         FROM conversation_requests r JOIN json_each(?) ids ON ids.value = r.id
         WHERE r.session_id = ? AND r.session_version = ? AND r.status = 'interrupted'
         AND NOT EXISTS (SELECT 1 FROM conversation_artifacts a WHERE a.id = r.id)
         AND NOT EXISTS (SELECT 1 FROM conversation_completions c WHERE c.request_id = r.id)
         AND NOT EXISTS (SELECT 1 FROM conversation_deleted_artifacts d WHERE d.id = r.id)
         AND NOT EXISTS (SELECT 1 FROM conversation_invalid_parents p WHERE p.id = r.id)
         AND NOT EXISTS (
           SELECT 1 FROM conversation_request_sources x
           JOIN conversation_request_removed_sources m ON m.id = x.source_id
           WHERE x.request_id = r.id
         )`,
        [selected, sessionId, version, selected, sessionId, version],
      );
      const pending = new Map<string, T>();
      const savedIds: string[] = [];
      for (const row of rows) {
        if (
          typeof row.id !== 'string' ||
          typeof row.created_at !== 'string' ||
          !Number.isFinite(Date.parse(row.created_at)) ||
          new Date(row.created_at).toISOString() !== row.created_at
        )
          continue;
        const interruptionReason = decodeConversationRecoveryReason(
          row.interruption_reason,
        );
        if (row.result_json === null) {
          if (
            row.checkpoint_status === 'interrupted' &&
            typeof row.checkpoint_question === 'string' &&
            row.checkpoint_question.trim()
          ) {
            const projected = project(row.id, undefined, {
              id: row.id,
              sessionId,
              createdAt: row.created_at,
              question: row.checkpoint_question,
              status: 'interrupted',
              ...(interruptionReason ? { interruptionReason } : {}),
            });
            if (projected !== null) pending.set(row.id, projected);
          }
          continue;
        }
        const value = readArchivedText(row.result_json);
        if (
          !value ||
          value.id !== row.id ||
          value.sessionId !== sessionId ||
          value.createdAt !== row.created_at ||
          (value.status !== 'complete' && value.status !== 'partial') ||
          (row.request_id != null &&
            (value.status === 'complete'
              ? row.checkpoint_status !== 'completed' ||
                row.completion_id !== row.id
              : row.checkpoint_status !== 'interrupted' ||
                row.completion_id != null)) ||
          typeof value.question !== 'string' ||
          (row.request_id != null &&
            value.question !== row.checkpoint_question) ||
          typeof value.answer !== 'string' ||
          !value.answer.trim()
        )
          continue;
        const dailyReport =
          value.status === 'complete' &&
          validConversationReportTarget(value.dailyReport)
            ? (value.dailyReport as NonNullable<
                ConversationArtifact['dailyReport']
              >)
            : undefined;
        savedIds.push(row.id);
        const valueForRoute = project(row.id, value, {
          id: row.id,
          sessionId,
          createdAt: value.createdAt,
          question: value.question,
          answer: value.answer,
          status: value.status,
          ...(dailyReport ? { dailyReport } : {}),
          ...(interruptionReason ? { interruptionReason } : {}),
        });
        if (valueForRoute !== null) pending.set(row.id, valueForRoute);
      }
      for (const id of await suppressExplicitlyRemovedHistory(tx, savedIds))
        pending.delete(id);
      for (const id of ids) {
        const projected = pending.get(id) ?? null;
        if (projected !== null && authorize) await authorize(tx, projected);
        output.push(projected);
      }
    });
    return output;
  };
}

/** Keep the display-only and prompt-only contracts on the same encrypted owner. */
export function createConversationProjectionReaders(
  database: SqlDatabase,
  ensure: () => Promise<void>,
) {
  const readSessionPresentationMany = createOwnedArchiveReader(
    database,
    ensure,
    (_id, value, row) => {
      const savedCitations = projectSavedArchivedCitations(value?.citations);
      return savedCitations.length ? { ...row, savedCitations } : row;
    },
  );
  return {
    ...createProtectedPromptHistory(database, ensure),
    readSessionPresentationMany,
    async readSelectedArchivedCitation(
      sessionId: string,
      version: number,
      id: string,
      createdAt: string,
      ordinal: number,
    ) {
      const read = createOwnedArchiveReader(
        database,
        ensure,
        (_id, value, row) =>
          value && row.createdAt === createdAt
            ? selectArchivedCitation(value, ordinal)
            : null,
        (tx, source) =>
          assertConversationSourcesNotRemoved(tx, { sources: [source] }),
      );
      return (await read(sessionId, version, [id]))[0] ?? null;
    },
  };
}
