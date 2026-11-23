import * as steeringHistory from './conversationSteeringHistory';
import {
  decodeOwnedArchiveRow,
  type ConversationHistoryPresentation,
} from './conversationArchivePresentationRow';
import { currentReviewedOpeningSql } from './conversationReviewedOpeningStorage';
export type { ConversationHistoryPresentation } from './conversationArchivePresentationRow';
import {
  archivedHealthSummaryOwner,
  readArchivedHealthSummaryPresentation,
  selectArchivedHealthSummaryCitation,
  type ArchivedHealthSummaryOwner,
} from './archivedHealthSummaryPresentation';
import { assertConversationSourcesNotRemoved } from './conversationArtifactDependencies';
import { selectArchivedCitation } from './selectArchivedCitation';
import { createProtectedPromptHistory } from './protectedPromptHistory';
import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import { projectSavedArchivedCitations } from '../ragConversation/savedArchivedCitations';
import { suppressExplicitlyRemovedHistory } from './conversationHistoryDisplayAncestorFence';
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
  authorize?: (tx: SqlExecutor, value: T) => Promise<T | null>,
  readSavedSummaryCards?: true,
  decorate?: (
    tx: SqlExecutor,
    sessionId: string,
    version: number,
    rows: Map<string, T>,
    schema: number,
  ) => Promise<void>,
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
      const steering = decorate
        ? `, ${steeringHistory.steeringHistorySchemaSql} AS steering`
        : '';
      const lease = await tx.execute(
        `SELECT s.id${steering} FROM conversation_artifact_sessions s
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
          r.interruption_reason, c.request_id AS completion_id, NULL AS local_outcome_json, ${currentReviewedOpeningSql}
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
           r.interruption_reason, NULL, r.local_outcome_json, ${currentReviewedOpeningSql}
         FROM conversation_requests r JOIN json_each(?) ids ON ids.value = r.id
         WHERE r.session_id = ? AND r.session_version = ? AND (r.status = 'interrupted' OR (r.status = 'completed' AND r.input_json IS NULL AND r.local_outcome_json IS NOT NULL))
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
      const summaryRows = new Map<
        string,
        {
          value: Record<string, unknown>;
          row: ConversationHistoryPresentation;
          owner: ArchivedHealthSummaryOwner;
        }
      >();
      for (const row of rows) {
        const decoded = decodeOwnedArchiveRow(row, sessionId);
        if (!decoded) continue;
        const { value, presentation } = decoded;
        const { id } = presentation;
        if (!value) {
          const projected = project(id, undefined, presentation);
          if (projected !== null) pending.set(id, projected);
          continue;
        }
        const owner = readSavedSummaryCards
          ? archivedHealthSummaryOwner(id, value)
          : undefined;
        if (owner) summaryRows.set(id, { value, row: presentation, owner });
        savedIds.push(id);
        const valueForRoute = project(id, value, presentation);
        if (valueForRoute !== null) pending.set(id, valueForRoute);
      }
      for (const id of await suppressExplicitlyRemovedHistory(tx, savedIds))
        pending.delete(id);
      if (summaryRows.size) {
        const summaries = await readArchivedHealthSummaryPresentation(
          tx,
          [...summaryRows.values()]
            .filter(item => pending.has(item.row.id))
            .map(item => item.owner),
        );
        for (const [id, healthSummary] of summaries) {
          const item = summaryRows.get(id);
          if (!item || item.row.status !== 'complete') continue;
          const enriched = project(id, item.value, {
            ...item.row,
            healthSummary,
          });
          if (enriched !== null) pending.set(id, enriched);
        }
      }
      const schema = Number(lease.rows[0].steering ?? 0);
      await decorate?.(tx, sessionId, version, pending, schema);
      for (const id of ids) {
        const projected = pending.get(id) ?? null;
        output.push(
          projected !== null && authorize
            ? await authorize(tx, projected)
            : projected,
        );
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
  const readSessionPresentationMany =
    createOwnedArchiveReader<ConversationHistoryPresentation>(
      database,
      ensure,
      (_id, value, row) => {
        const savedCitations = projectSavedArchivedCitations(value?.citations);
        return savedCitations.length ? { ...row, savedCitations } : row;
      },
      undefined,
      true,
      async (tx, sessionId, version, rows, schema) => {
        const complete = [...rows].filter(
          ([, row]) => row.status === 'complete',
        );
        const receipts =
          await steeringHistory.readConversationSteeringHistoryMany(
            tx,
            sessionId,
            version,
            complete.map(([id]) => id),
            schema,
          );
        for (const [id, row] of complete) {
          const steeringInstructions = receipts.get(id);
          if (row.status === 'complete' && steeringInstructions?.length)
            rows.set(id, { ...row, steeringInstructions });
        }
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
      summary?: { readonly id: string; readonly revision: string },
    ) {
      const read = createOwnedArchiveReader<{
        source?: NonNullable<ReturnType<typeof selectArchivedCitation>>;
        owner?: ArchivedHealthSummaryOwner;
      }>(
        database,
        ensure,
        (turnId, value, row) => {
          if (!value || row.createdAt !== createdAt) return null;
          if (summary === undefined) {
            const source = selectArchivedCitation(value, ordinal);
            return source ? { source } : null;
          }
          const owner = archivedHealthSummaryOwner(turnId, value);
          return owner?.reference.summaryId === summary.id ? { owner } : null;
        },
        async (tx, selected) => {
          const source =
            selected.owner && summary
              ? await selectArchivedHealthSummaryCitation(
                  tx,
                  selected.owner,
                  ordinal,
                  summary.revision,
                )
              : selected.source;
          if (!source) return null;
          await assertConversationSourcesNotRemoved(tx, { sources: [source] });
          return { source };
        },
      );
      return (await read(sessionId, version, [id]))[0]?.source ?? null;
    },
  };
}
