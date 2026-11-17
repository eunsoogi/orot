import { dailyReportStorageLookup } from './dailyReportStorageLookup';
import {
  acquireReportCalendarGuard,
  type ReportCalendarReader,
} from '../aiFeatures/integration/dailyReportSystemCalendar';
import { createManualHistoryRepository, type SqlDatabase } from '@orot/storage';
import { stableJson } from '../aiFeatures/integration/evidenceUtils';
import {
  ensureHealthContextGeneration,
  readHealthContextGeneration,
} from '../healthEvidence/healthContext/generation';
import { createSymptomSummaryStorage } from './symptomSummaryStorage';
import { assertRetainedRecordsCurrent } from './retainedRecordFreshness';
import {
  retainedDailyReportRecords,
  validateDailyReportSave,
} from './dailyReportLineage';
import {
  invalidateDailyReportRun,
  invalidDailyReportStatus,
} from './dailyReportInvalidation';
import type { DailyReportSave } from './dailyReportStorageTypes';
import {
  checkDailyReportSaveCancellation,
  dailyReportSaveFailure,
} from './dailyReportSaveCancellation';
import type { DailyReportSaveStatus } from './dailyReportSaveCancellation';
export type {
  DailyReportLineage,
  DailyReportSave,
} from './dailyReportStorageTypes';
/** The same encrypted summary database serializes both entry points and all revision changes. */
export function createDailyReportStorage(
  database: SqlDatabase,
  calendarReader?: ReportCalendarReader,
) {
  const summaries = createSymptomSummaryStorage(database);
  const manualHistory = createManualHistoryRepository(database);
  let ready: Promise<void> | undefined;
  const ensure = () =>
    (ready ??= (async () => {
      await summaries.list();
      await database.transaction(async tx => {
        await ensureHealthContextGeneration(tx);
      });
    })().catch(error => {
      ready = undefined;
      throw error;
    }));
  const lookup = dailyReportStorageLookup(
    database,
    manualHistory,
    ensure,
    calendarReader,
  );
  async function save(
    input: DailyReportSave,
    signal?: AbortSignal,
  ): Promise<{ status: DailyReportSaveStatus }> {
    const checked = validateDailyReportSave(input);
    if (!checked) return { status: 'error' as const };
    const stored = JSON.stringify({
      inputLineage: 'complete',
      ...checked,
      lineage: input.lineage,
    });
    const guard = await acquireReportCalendarGuard(
      checked.context,
      calendarReader,
      signal,
    );
    if (!guard) return { status: 'stale' };
    try {
      await ensure();
      let status: 'saved' | 'reused' | 'stale' | 'deleted' = 'stale';
      await database.transaction(async tx => {
        checkDailyReportSaveCancellation(signal);
        const invalid = await tx.execute(
          'SELECT id FROM conversation_invalid_summaries WHERE id = ?',
          [input.runId],
        );
        if (invalid.rows.length) {
          status = await invalidDailyReportStatus(tx, input.runId);
          return;
        }
        // Direct source validation runs inside the same write transaction as the active pointer.
        const records = retainedDailyReportRecords(input.lineage);
        await assertRetainedRecordsCurrent(tx, records, manualHistory);
        if (!(await guard.revalidate(signal)) || !guard.isCurrent()) return;
        const existing = (
          await tx.execute(
            'SELECT result_json FROM symptom_summary_runs WHERE id = ?',
            [input.runId],
          )
        ).rows[0];
        const prior = (
          await tx.execute(
            'SELECT identity_key FROM daily_report_revisions WHERE run_id = ?',
            [input.runId],
          )
        ).rows[0];
        const head = (
          await tx.execute(
            'SELECT active_run_id, revision, deleted FROM daily_report_heads WHERE identity_key = ?',
            [checked.context.identity.key],
          )
        ).rows[0];
        if (existing || prior) {
          if (
            typeof existing?.result_json === 'string' &&
            stableJson(JSON.parse(existing.result_json)) ===
              stableJson(JSON.parse(stored)) &&
            prior?.identity_key === checked.context.identity.key
          )
            status = head?.active_run_id === input.runId ? 'reused' : 'stale';
          else if (!existing && prior) status = 'deleted';
          else throw new Error('Run identity conflict.');
          return;
        }
        const generation = await readHealthContextGeneration(tx);
        if (
          generation.mutationGeneration !==
            checked.context.sourceSnapshot.mutationGeneration ||
          generation.deletionGeneration !==
            checked.context.sourceSnapshot.deletionGeneration
        )
          return;
        if (input.mode.kind === 'initial' && head) {
          status = head.deleted === 1 ? 'deleted' : 'stale';
          return;
        }
        if (
          input.mode.kind === 'revise' &&
          (!head || (head.active_run_id ?? null) !== input.mode.expectedRunId)
        )
          return;
        const revision = head ? Number(head.revision) + 1 : 1;
        await tx.execute(
          'INSERT INTO symptom_summary_runs (id, created_at, model_name, result_json) VALUES (?, ?, ?, ?)',
          [
            input.runId,
            checked.report.generatedAt,
            checked.context.provider.modelId,
            stored,
          ],
        );
        for (const item of input.lineage)
          await tx.execute(
            'INSERT OR IGNORE INTO symptom_summary_sources (summary_id, record_kind, record_id) VALUES (?, ?, ?)',
            [input.runId, item.kind, item.localId],
          );
        await tx.execute(
          'INSERT INTO daily_report_revisions (identity_key, revision, run_id) VALUES (?, ?, ?)',
          [checked.context.identity.key, revision, input.runId],
        );
        await tx.execute(
          'INSERT INTO daily_report_heads (identity_key, active_run_id, revision, deleted) VALUES (?, ?, ?, 0) ON CONFLICT(identity_key) DO UPDATE SET active_run_id = excluded.active_run_id, revision = excluded.revision, deleted = 0',
          [checked.context.identity.key, input.runId, revision],
        );
        // Downstream saved artifacts must not keep a superseded active revision alive.
        if (typeof head?.active_run_id === 'string')
          await invalidateDailyReportRun(tx, head.active_run_id);
        checkDailyReportSaveCancellation(signal);
        status = 'saved';
      });
      if (!guard.isCurrent()) {
        await invalidateDailyReportRun(database, input.runId);
        return { status: 'stale' };
      }
      return { status };
    } catch (error) {
      return { status: dailyReportSaveFailure(error) };
    } finally {
      guard.dispose();
    }
  }
  return { lookup, save };
}
