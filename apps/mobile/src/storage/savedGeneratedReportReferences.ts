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

type Lease = Readonly<{ id: string; version: number }>;
export type SavedGeneratedReportReference = Readonly<{
  artifactId: string;
  savedAt: string;
  reportKind?: 'health_summary' | 'disease_possibilities';
}>;

/** The bookmark belongs to the protected generated artifact, not the model's memory corpus. */
export async function setupSavedGeneratedReportReferences(tx: SqlExecutor) {
  await setupSavedHealthSummaryReferences(tx);
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

const visible = `FROM saved_generated_report_refs b
  JOIN conversation_artifacts a ON a.id = b.artifact_id
  JOIN symptom_summary_runs run ON run.id = b.report_id
  JOIN conversation_artifact_sessions s ON s.id = a.session_id
  JOIN conversation_artifact_generation g ON g.singleton = 1 AND g.generation = s.generation
  WHERE s.hidden = 0`;

/** Pin a complete daily report only while its selected conversation and protected sources still agree. */
export function createSavedGeneratedReportReferences(
  database: SqlDatabase,
  ensure: () => Promise<void>,
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
  const summary = createSavedHealthSummaryReferences(database, ensure);
  const possibilities = createSavedDiseasePossibilityReferences(
    database,
    ensure,
  );
  return {
    ...summary,
    ...possibilities,
    async bookmarkDailyReport(input: {
      artifactId: string;
      lease: Lease;
      current: () => boolean;
      savedAt?: string;
    }) {
      if (!input.current()) return false;
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
            `SELECT a.result_json ${visible} AND b.report_id = ?`,
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
        if (!input.current()) throw new Error('Report bookmark owner moved.');
        tx.commit();
        saved = true;
      });
      return saved;
    },
    async listSavedGeneratedReportReferences(): Promise<
      SavedGeneratedReportReference[]
    > {
      const summaries = [
        ...(await summary.listSavedHealthSummaryReferences()),
        ...(await possibilities.listSavedDiseasePossibilityReferences()),
      ];
      if (!(await catalogExists())) return summaries;
      const { rows } = await database.execute(
        `SELECT b.artifact_id, b.saved_at ${visible} ORDER BY b.saved_at DESC, b.artifact_id`,
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
            `SELECT a.result_json, b.report_id ${visible} AND a.id = ?`,
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
