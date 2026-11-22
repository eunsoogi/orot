import {
  createManualHistoryRepository,
  type SqlDatabase,
  type SqlExecutor,
} from '@orot/storage';
import { validateDailyReportArtifact } from './dailyReportArtifactValidation';
import { decodeConversationArtifact } from './conversationArtifactCodec';
import { assertConversationArtifactCurrent } from './conversationArtifactFreshness';
import { withWritePeriodCalculations } from './writePeriodCalculationScope';
import type { dailyReportAutomaticMemorySetting } from './dailyReportAutomaticMemorySetting';

type Lease = Readonly<{ id: string; version: number }>;

export const visibleDailyReportBookmarks = `FROM saved_generated_report_refs b
  JOIN conversation_artifacts a ON a.id = b.artifact_id
  JOIN symptom_summary_runs run ON run.id = b.report_id
  JOIN conversation_artifact_sessions s ON s.id = a.session_id
  JOIN conversation_artifact_generation g ON g.singleton = 1 AND g.generation = s.generation
  WHERE s.hidden = 0`;

/** A legacy answer or a parked/partial request is never completion authority. */
async function completedDailyReportRequest(
  tx: SqlExecutor,
  id: string,
  lease: Lease,
) {
  return Boolean(
    (
      await tx.execute(
        `SELECT 1 FROM conversation_completions c JOIN conversation_requests r
      ON r.id = c.request_id AND r.session_id = c.session_id
      WHERE c.message_id = ? AND r.id = ? AND r.session_id = ?
      AND r.session_version = ? AND r.status = 'completed'`,
        [id, id, lease.id, lease.version],
      )
    ).rows.length,
  );
}

/** Both explicit and automatic pins share the original protected report authority. */
export function createDailyReportBookmark(
  database: SqlDatabase,
  ensure: () => Promise<void>,
  setting: ReturnType<typeof dailyReportAutomaticMemorySetting>,
) {
  const history = createManualHistoryRepository(database);
  return async function bookmarkDailyReport(
    input: {
      artifactId: string;
      lease: Lease;
      current: () => boolean;
      savedAt?: string;
    },
    automatic?: { token: object; runId: string; revision: number },
  ) {
    if (!input.current()) return false;
    const automaticCurrent = automatic
      ? setting.consume(automatic.token, input)
      : undefined;
    await ensure();
    let saved = false;
    await database.transaction(async tx => {
      if (!input.current()) return;
      const row = (
        await tx.execute(
          `SELECT a.result_json
          FROM conversation_artifacts a
          JOIN conversation_artifact_sessions s ON s.id = a.session_id
          JOIN conversation_artifact_generation g ON g.singleton = 1 AND g.generation = s.generation
          WHERE a.id = ? AND s.id = ? AND s.version = ? AND s.hidden = 0`,
          [input.artifactId, input.lease.id, input.lease.version],
        )
      ).rows[0];
      const artifact = decodeConversationArtifact(row?.result_json);
      if (
        !artifact?.dailyReport ||
        artifact.status !== 'complete' ||
        artifact.id !== input.artifactId ||
        artifact.sessionId !== input.lease.id ||
        !input.current()
      )
        return;
      await withWritePeriodCalculations(tx, validate =>
        assertConversationArtifactCurrent(
          tx,
          database,
          artifact,
          false,
          validate,
        ),
      );
      const reference = artifact.dailyReport;
      if (
        automatic &&
        (!automaticCurrent ||
          reference.runId !== automatic.runId ||
          reference.revision !== automatic.revision ||
          !(await automaticCurrent.matches(tx)) ||
          !(await completedDailyReportRequest(tx, artifact.id, input.lease)))
      )
        return;
      const original = await validateDailyReportArtifact(
        tx,
        reference.runId,
        history,
        true,
      );
      if (
        !input.current() ||
        !original ||
        original.revision !== reference.revision ||
        original.context.identity.key !== reference.identity.key
      )
        return;
      await tx.execute(
        'INSERT INTO saved_generated_report_refs VALUES (?, ?, ?) ON CONFLICT(report_id) DO NOTHING',
        [
          reference.runId,
          artifact.id,
          input.savedAt ?? new Date().toISOString(),
        ],
      );
      const existing = (
        await tx.execute(
          `SELECT a.result_json ${visibleDailyReportBookmarks} AND b.report_id = ?`,
          [reference.runId],
        )
      ).rows[0];
      const savedReference = decodeConversationArtifact(
        existing?.result_json,
      )?.dailyReport;
      if (
        savedReference?.runId !== reference.runId ||
        savedReference.revision !== reference.revision ||
        savedReference.identity.key !== reference.identity.key
      )
        throw new Error('Report bookmark target no longer matches.');
      // The driver otherwise awaits our callback before committing. Keep
      // publication adjacent to this last live owner check, with no await.
      if (
        (automaticCurrent && !(await automaticCurrent.matches(tx))) ||
        (automaticCurrent && !automaticCurrent.live()) ||
        !input.current()
      )
        throw new Error('Report bookmark owner moved.');
      tx.commit();
      saved = true;
    });
    return saved;
  };
}
