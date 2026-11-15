import {
  DailyReportIdentitySchema,
  type DailyReportIdentity,
} from '@orot/domain';
import type { SqlDatabase, ManualHistoryRepository } from '@orot/storage';
import {
  acquireReportCalendarGuard,
  type ReportCalendarReader,
} from '../aiFeatures/integration/dailyReportSystemCalendar';
import { validateDailyReportCompletion } from './dailyReportValidation';
import { parseDailyReportLineage } from './dailyReportLineage';
import {
  dailyReportSourcesChanged,
  invalidateDailyReportRun,
} from './dailyReportInvalidation';
import { visibleSummary } from './symptomSummaryQuarantine';
import type { DailyReportLookup } from './dailyReportStorageTypes';

/** Keep native event invalidation live until the validated SQLite snapshot is returned. */
export function dailyReportStorageLookup(
  database: SqlDatabase,
  manualHistory: ManualHistoryRepository,
  ensure: () => Promise<void>,
  calendarReader?: ReportCalendarReader,
) {
  return async function lookup(
    identity: DailyReportIdentity,
    signal?: AbortSignal,
  ) {
    if (signal?.aborted) return { status: 'error' as const };
    const parsed = DailyReportIdentitySchema.safeParse(identity);
    if (!parsed.success) return { status: 'error' as const };
    const lease: {
      current: Awaited<ReturnType<typeof acquireReportCalendarGuard>>;
    } = { current: null };
    try {
      await ensure();
      let value: unknown;
      await database.transaction(async tx => {
        const head = (
          await tx.execute(
            'SELECT active_run_id, revision, deleted FROM daily_report_heads WHERE identity_key = ?',
            [parsed.data.key],
          )
        ).rows[0];
        if (!head) {
          value = { status: 'missing' };
          return;
        }
        if (head.deleted === 1 || typeof head.active_run_id !== 'string') {
          value = { status: 'deleted' };
          return;
        }
        const row = (
          await tx.execute(
            `SELECT r.result_json, EXISTS (SELECT 1 FROM conversation_invalid_summaries i WHERE i.id = r.id) AS invalid FROM symptom_summary_runs r WHERE r.id = ? AND ${visibleSummary}`,
            [head.active_run_id],
          )
        ).rows[0];
        if (!row || typeof row.result_json !== 'string') {
          value = { status: 'deleted' };
          return;
        }
        const saved = JSON.parse(row.result_json);
        const checked = validateDailyReportCompletion(saved.context, {
          status: 'completed',
          report: saved.report,
        });
        const lineage =
          checked && parseDailyReportLineage(checked.context, saved.lineage);
        if (
          !checked ||
          !lineage ||
          checked.context.identity.key !== parsed.data.key
        ) {
          value = { status: 'error' };
          return;
        }
        const sourceStatus = await dailyReportSourcesChanged(
          tx,
          row.invalid === 1,
          lineage,
          manualHistory,
        );
        lease.current = await acquireReportCalendarGuard(
          checked.context,
          calendarReader,
          signal,
        );
        if (signal?.aborted) {
          value = { status: 'error' };
          return;
        }
        if (sourceStatus !== 'current' || !lease.current?.isCurrent()) {
          await invalidateDailyReportRun(tx, head.active_run_id);
          value = {
            status: 'stale',
            runId: head.active_run_id,
            revision: head.revision,
            sourceStatus: sourceStatus === 'deleted' ? 'deleted' : 'stale',
          };
          return;
        }
        value = {
          status: 'saved',
          runId: head.active_run_id,
          revision: head.revision,
          lineage,
          ...checked,
        };
      });
      if (signal?.aborted) return { status: 'error' as const };
      const result = value as DailyReportLookup;
      if (result.status === 'saved' && !(lease.current?.isCurrent() ?? false)) {
        await invalidateDailyReportRun(database, result.runId);
        return {
          status: 'stale' as const,
          runId: result.runId,
          revision: result.revision,
          sourceStatus: 'stale' as const,
        };
      }
      return result;
    } catch {
      return { status: 'error' as const };
    } finally {
      lease.current?.dispose();
    }
  };
}
