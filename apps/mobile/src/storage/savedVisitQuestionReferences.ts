import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import { fingerprint } from '../aiFeatures/integration/evidenceUtils';
import { RetainedSourceInvalidError } from '../aiFeatures/integration/retainedSourceError';
import { visitQuestionsBookmarkTarget } from '../ragConversation/visitQuestionsBookmarkTarget';
import { decodeConversationArtifact } from './conversationArtifactCodec';
import { assertConversationArtifactCurrent } from './conversationArtifactFreshness';
import { withWritePeriodCalculations } from './writePeriodCalculationScope';

type Current = () => boolean;

/** Pin the existing report revision. Keep no editable question rows or report body here. */
export async function setupSavedVisitQuestionReferences(tx: SqlExecutor) {
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS saved_visit_question_refs (artifact_id TEXT PRIMARY KEY NOT NULL, revision TEXT NOT NULL, saved_at TEXT NOT NULL)',
  );
  await tx.execute(`CREATE TRIGGER IF NOT EXISTS saved_visit_question_removed
    AFTER DELETE ON conversation_artifacts BEGIN
      DELETE FROM saved_visit_question_refs WHERE artifact_id = OLD.id;
    END`);
  await tx.execute(`CREATE TRIGGER IF NOT EXISTS saved_visit_question_changed
    AFTER UPDATE OF result_json ON conversation_artifacts
    WHEN NEW.result_json IS NOT OLD.result_json BEGIN
      DELETE FROM saved_visit_question_refs WHERE artifact_id = OLD.id;
    END`);
}

const original = `JOIN conversation_artifact_sessions s ON s.id = a.session_id AND s.hidden = 0
  JOIN conversation_artifact_generation g ON g.singleton = 1 AND g.generation = s.generation
  JOIN conversation_completions c ON c.message_id = a.id AND c.request_id = a.id AND c.session_id = s.id
  JOIN conversation_requests r ON r.id = c.request_id AND r.session_id = s.id AND r.session_version = s.version
  WHERE r.status = 'completed' AND r.input_json IS NULL AND r.interruption_reason IS NULL
    AND NOT EXISTS (SELECT 1 FROM conversation_deleted_artifacts WHERE id = a.id)
    AND NOT EXISTS (SELECT 1 FROM conversation_artifact_removed_sessions WHERE id = s.id)
    AND NOT EXISTS (SELECT 1 FROM conversation_invalid_parents WHERE id = a.id)`;
const catalog = `FROM saved_visit_question_refs b JOIN conversation_artifacts a ON a.id = b.artifact_id ${original}`;

export function createSavedVisitQuestionReferences(
  database: SqlDatabase,
  ensure: () => Promise<void>,
) {
  const exists = async () =>
    Boolean(
      (
        await database.execute(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'saved_visit_question_refs'",
        )
      ).rows.length,
    );
  const resolve = async (
    tx: SqlExecutor,
    row: Record<string, unknown> | undefined,
    id: string,
    current: Current,
  ) => {
    const artifact = decodeConversationArtifact(row?.result_json);
    const visit = artifact?.visitQuestions;
    if (
      !current() ||
      !artifact ||
      !visit ||
      artifact.id !== id ||
      artifact.sessionId !== row?.session_id ||
      artifact.createdAt !== row?.created_at ||
      artifact.status !== 'complete' ||
      artifact.entryIntent ||
      artifact.healthSummary ||
      artifact.dailyReport ||
      artifact.treatmentContext ||
      artifact.submittedInput
    )
      return null;
    const target = visitQuestionsBookmarkTarget(
      visit.appointmentId,
      visit.candidates,
    );
    // Decoding proves that the appointment and every candidate reference belong to this artifact.
    if (!target) return null;
    try {
      await withWritePeriodCalculations(tx, validate =>
        assertConversationArtifactCurrent(
          tx,
          database,
          artifact,
          false,
          validate,
        ),
      );
    } catch (error) {
      if (error instanceof RetainedSourceInvalidError) return null;
      throw error;
    }
    return current()
      ? {
          target,
          revision: fingerprint(artifact),
          questions: visit.candidates.map(
            ({ identity, questionText, rationale }) => ({
              id: identity!.id,
              questionText,
              rationale,
            }),
          ),
        }
      : null;
  };
  return {
    async bookmarkVisitQuestions(input: {
      artifactId: string;
      displayed: string;
      lease: { id: string; version: number };
      current: Current;
    }) {
      if (!input.current()) return false;
      await ensure();
      let saved = false;
      await database.transaction(async tx => {
        if (!input.current()) return;
        const row = (
          await tx.execute(
            `SELECT a.result_json, a.session_id, a.created_at FROM conversation_artifacts a ${original} AND a.id = ? AND s.id = ? AND s.version = ?`,
            [input.artifactId, input.lease.id, input.lease.version],
          )
        ).rows[0];
        const result = await resolve(tx, row, input.artifactId, input.current);
        if (!result || result.target !== input.displayed || !input.current())
          return;
        await setupSavedVisitQuestionReferences(tx);
        await tx.execute(
          'INSERT INTO saved_visit_question_refs VALUES (?, ?, ?) ON CONFLICT(artifact_id) DO NOTHING',
          [input.artifactId, result.revision, new Date().toISOString()],
        );
        const pin = (
          await tx.execute(`SELECT b.revision ${catalog} AND a.id = ?`, [
            input.artifactId,
          ])
        ).rows[0];
        if (pin?.revision !== result.revision || !input.current())
          throw new RetainedSourceInvalidError(
            'The displayed visit report moved before saving.',
          );
        tx.commit();
        saved = true;
      });
      return saved;
    },
    async listSavedVisitQuestionReferences() {
      if (!(await exists())) return [];
      const visible: {
        artifactId: string;
        savedAt: string;
        reportKind: 'visit_questions';
      }[] = [];
      await database.transaction(async tx => {
        const { rows } = await tx.execute(
          `SELECT b.artifact_id, b.saved_at, b.revision, a.result_json, a.session_id, a.created_at ${catalog} ORDER BY b.saved_at DESC, b.artifact_id`,
        );
        for (const row of rows) {
          if (
            typeof row.artifact_id !== 'string' ||
            typeof row.saved_at !== 'string' ||
            !Number.isFinite(Date.parse(row.saved_at)) ||
            typeof row.revision !== 'string' ||
            (await resolve(tx, row, row.artifact_id, () => true))?.revision !==
              row.revision
          )
            continue;
          // A revoked source hides even the generic catalog entry.
          visible.push({
            artifactId: row.artifact_id,
            savedAt: row.saved_at,
            reportKind: 'visit_questions',
          });
        }
      });
      return visible;
    },
    async readSavedVisitQuestionReference(
      artifactId: string,
      current: Current,
    ) {
      if (!current() || !(await exists())) return null;
      let result:
        NonNullable<Awaited<ReturnType<typeof resolve>>>['questions'] | null =
        null;
      await database.transaction(async tx => {
        if (!current()) return;
        const row = (
          await tx.execute(
            `SELECT a.result_json, a.session_id, a.created_at, b.revision ${catalog} AND a.id = ?`,
            [artifactId],
          )
        ).rows[0];
        const resolved = await resolve(tx, row, artifactId, current);
        if (resolved && resolved.revision === row?.revision && current())
          result = resolved.questions;
      });
      return current() ? result : null;
    },
  };
}
