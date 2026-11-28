import { setupSavedHealthSummarySections } from './savedHealthSummarySections';
import { createSavedVisitQuestionReferences } from './savedVisitQuestionReferences';
import {
  createDailyReportBookmark,
  visibleDailyReportBookmarks,
} from './dailyReportMemoryBookmark';
import {
  dailyReportAutomaticMemorySetting,
  setupDailyReportAutomaticMemory,
} from './dailyReportAutomaticMemorySetting';
import {
  createSavedDiseasePossibilityReferences,
  setupSavedDiseasePossibilityReferences,
} from './savedDiseasePossibilityReferences';
import { createManualHistoryRepository } from '@orot/storage';
import { validateDailyReportArtifact } from './dailyReportArtifactValidation';
import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import { decodeConversationArtifact } from './conversationArtifactCodec';
import { assertConversationArtifactCurrent } from './conversationArtifactFreshness';
import { withWritePeriodCalculations } from './writePeriodCalculationScope';
import {
  createSavedHealthSummaryReferences,
  setupSavedHealthSummaryReferences,
} from './savedHealthSummaryReferences';

type Original = NonNullable<
  Awaited<ReturnType<typeof validateDailyReportArtifact>>
> & { status: 'saved' };

export type SavedGeneratedReportReference = Readonly<{
  artifactId: string;
  savedAt: string;
  reportKind?:
    | 'health_summary'
    | 'health_summary_section'
    | 'disease_possibilities'
    | 'visit_questions';
}>;

/** The bookmark belongs to the protected generated artifact, not the model's memory corpus. */
export async function setupSavedGeneratedReportReferences(tx: SqlExecutor) {
  await setupDailyReportAutomaticMemory(tx);
  await setupSavedHealthSummaryReferences(tx);
  await setupSavedHealthSummarySections(tx);
  await setupSavedDiseasePossibilityReferences(tx);
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS saved_generated_report_refs (report_id TEXT PRIMARY KEY NOT NULL, artifact_id TEXT UNIQUE NOT NULL, saved_at TEXT NOT NULL)',
  );
  await tx.execute(`CREATE TRIGGER IF NOT EXISTS saved_generated_report_removed
    AFTER DELETE ON conversation_artifacts BEGIN
      DELETE FROM saved_generated_report_refs WHERE artifact_id = OLD.id;
    END`);
  await tx.execute(`CREATE TRIGGER IF NOT EXISTS saved_generated_report_run_removed
    AFTER DELETE ON symptom_summary_runs BEGIN
      DELETE FROM saved_generated_report_refs WHERE report_id = OLD.id;
    END`);
}

/** Pin a complete daily report only while its selected conversation and protected sources still agree. */
export function createSavedGeneratedReportReferences(
  database: SqlDatabase,
  ensure: () => Promise<void>,
  isCurrentDatabase?: (database: SqlDatabase) => boolean,
) {
  const catalogExists = async () =>
    Boolean(
      (
        await database.execute(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'saved_generated_report_refs'",
        )
      ).rows.length,
    );
  const history = createManualHistoryRepository(database);
  const summary = createSavedHealthSummaryReferences(
    database,
    ensure,
    () => isCurrentDatabase?.(database) === true,
  );
  const possibilities = createSavedDiseasePossibilityReferences(
    database,
    ensure,
  );
  const visit = createSavedVisitQuestionReferences(database, ensure);
  const setting = dailyReportAutomaticMemorySetting(database, ensure);
  const bookmarkDailyReport = createDailyReportBookmark(
    database,
    ensure,
    setting,
  );
  return {
    ...summary,
    ...possibilities,
    ...visit,
    bookmarkDailyReport: (input: Parameters<typeof bookmarkDailyReport>[0]) =>
      bookmarkDailyReport(input),
    // The application must mint the token before starting an explicit live request.
    readAutomaticDailyReportMemory: setting.enabled,
    changeAutomaticDailyReportMemory: setting.change,
    admitAutomaticDailyReportMemory: setting.admit,
    bookmarkCompletedDailyReport: (
      input: Parameters<typeof bookmarkDailyReport>[0],
      admission: NonNullable<Parameters<typeof bookmarkDailyReport>[1]>,
    ) => bookmarkDailyReport(input, admission),
    async listSavedGeneratedReportReferences(): Promise<
      SavedGeneratedReportReference[]
    > {
      const summaries = [
        ...(await summary.listSavedHealthSummaryReferences()),
        ...(await summary.listSavedHealthSummarySections()),
        ...(await possibilities.listSavedDiseasePossibilityReferences()),
        ...(await visit.listSavedVisitQuestionReferences()),
      ];
      if (!(await catalogExists())) return summaries;
      const { rows } = await database.execute(
        `SELECT b.artifact_id, b.saved_at ${visibleDailyReportBookmarks} ORDER BY b.saved_at DESC, b.artifact_id`,
      );
      const daily = rows.flatMap(row =>
        typeof row.artifact_id === 'string' &&
        typeof row.saved_at === 'string' &&
        Number.isFinite(Date.parse(row.saved_at))
          ? [{ artifactId: row.artifact_id, savedAt: row.saved_at }]
          : [],
      );
      return [...daily, ...summaries].sort(
        (a, b) =>
          b.savedAt.localeCompare(a.savedAt) ||
          a.artifactId.localeCompare(b.artifactId),
      );
    },
    async readSavedGeneratedReportReference(
      artifactId: string,
      current: () => boolean,
    ): Promise<Original | null> {
      if (!current()) return null;
      if (!(await catalogExists())) return null;
      let result: Original | null = null;
      await database.transaction(async tx => {
        const row = (
          await tx.execute(
            `SELECT a.result_json, b.report_id ${visibleDailyReportBookmarks} AND a.id = ?`,
            [artifactId],
          )
        ).rows[0];
        const artifact = decodeConversationArtifact(row?.result_json);
        if (
          !artifact?.dailyReport ||
          artifact.status !== 'complete' ||
          artifact.id !== artifactId ||
          !current()
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
        if (row?.report_id !== reference.runId || !current()) return;
        const original = await validateDailyReportArtifact(
          tx,
          reference.runId,
          history,
          true,
        );
        if (
          !current() ||
          !original ||
          original.revision !== reference.revision ||
          original.context.identity.key !== reference.identity.key
        )
          return;
        result = { ...original, status: 'saved' };
      });
      return current() ? result : null;
    },
  };
}
