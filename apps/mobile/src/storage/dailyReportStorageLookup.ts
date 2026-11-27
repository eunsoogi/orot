import {
  beginReportCalendarProof,
  reportCalendarTransaction,
} from './reportCalendarTransactionTiming';
import {
  DailyReportIdentitySchema,
  type DailyReportIdentity,
} from '@orot/domain';
import type {
  SqlDatabase,
  SqlExecutor,
  ManualHistoryRepository,
} from '@orot/storage';
import {
  openReportCalendarCandidate,
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

async function selectActiveReport(tx: SqlExecutor, key: string) {
  const head = (
    await tx.execute(
      'SELECT active_run_id, revision, deleted FROM daily_report_heads WHERE identity_key = ?',
      [key],
    )
  ).rows[0];
  if (!head) return { status: 'missing' as const };
  if (head.deleted === 1 || typeof head.active_run_id !== 'string')
    return { status: 'deleted' as const };
  const row = (
    await tx.execute(
      `SELECT r.result_json, EXISTS (SELECT 1 FROM conversation_invalid_summaries i WHERE i.id = r.id) AS invalid FROM symptom_summary_runs r WHERE r.id = ? AND ${visibleSummary}`,
      [head.active_run_id],
    )
  ).rows[0];
  if (!row || typeof row.result_json !== 'string')
    return { status: 'deleted' as const };
  if (typeof head.revision !== 'number') return { status: 'error' as const };
  return {
    status: 'candidate' as const,
    runId: head.active_run_id,
    revision: head.revision,
    raw: row.result_json,
    invalid: row.invalid === 1,
  };
}

type CalendarCandidate = NonNullable<
  Awaited<ReturnType<typeof openReportCalendarCandidate>>
>;

/** Native Calendar sampling does not occupy the shared database queue before
 * the exact saved report has been readmitted. The last proof still does. */
export function dailyReportStorageLookup(
  database: SqlDatabase,
  manualHistory: ManualHistoryRepository,
  ensure: () => Promise<void>,
  calendarReader?: ReportCalendarReader,
) {
  const transaction = (work: Parameters<SqlDatabase['transaction']>[0]) =>
    reportCalendarTransaction(database, 'report_calendar_daily', work);
  return async function lookup(
    identity: DailyReportIdentity,
    signal?: AbortSignal,
  ): Promise<DailyReportLookup> {
    if (signal?.aborted) return { status: 'error' };
    const parsed = DailyReportIdentitySchema.safeParse(identity);
    if (!parsed.success) return { status: 'error' };
    const key = parsed.data.key;
    const lease: { current: CalendarCandidate | null } = { current: null };
    try {
      await ensure();
      let result: DailyReportLookup = { status: 'error' };
      const state: { finish?: () => Promise<void> } = {};
      await transaction(async tx => {
        if (signal?.aborted) return;
        const chosen = await selectActiveReport(tx, key);
        if (chosen.status !== 'candidate') {
          result = chosen;
          return;
        }
        const saved = JSON.parse(chosen.raw);
        const checked = validateDailyReportCompletion(saved.context, {
          status: 'completed',
          report: saved.report,
        });
        const lineage =
          checked && parseDailyReportLineage(checked.context, saved.lineage);
        if (!checked || !lineage || checked.context.identity.key !== key)
          return;
        const binding = checked.context.systemCalendar;
        const readmitted = async (owner: SqlExecutor) => {
          const current = await selectActiveReport(owner, key);
          if (current.status === 'deleted') result = current;
          // Never authorize a replacement revision using the old lease.
          return current.status === 'candidate' &&
            current.runId === chosen.runId &&
            current.revision === chosen.revision &&
            current.raw === chosen.raw
            ? current
            : undefined;
        };
        const finish = async (owner: SqlExecutor, invalid: boolean) => {
          if (signal?.aborted) return;
          let calendarCurrent = !binding;
          if (binding && !invalid && lease.current) {
            const proof = beginReportCalendarProof(owner, true);
            try {
              calendarCurrent =
                (await lease.current.revalidate(signal)) &&
                lease.current.isCurrent();
            } finally {
              proof?.();
            }
            if (signal?.aborted) return;
            // The installed driver permits direct same-connection dispatch
            // while a transaction callback waits. Readmit after the native
            // await, before any retained source can become publishable.
            const current = await readmitted(owner);
            if (!current) return;
            invalid = current.invalid;
          }
          if (signal?.aborted) return;
          const sourceStatus = await dailyReportSourcesChanged(
            owner,
            invalid,
            lineage,
            manualHistory,
          );
          if (signal?.aborted) return;
          if (binding && !lease.current?.isCurrent()) calendarCurrent = false;
          if (sourceStatus !== 'current' || !calendarCurrent) {
            await invalidateDailyReportRun(owner, chosen.runId);
            result = {
              status: 'stale',
              runId: chosen.runId,
              revision: chosen.revision,
              sourceStatus: sourceStatus === 'deleted' ? 'deleted' : 'stale',
            };
            return;
          }
          result = {
            status: 'saved',
            runId: chosen.runId,
            revision: chosen.revision,
            lineage,
            ...checked,
          };
        };
        if (!binding || chosen.invalid) {
          await finish(tx, chosen.invalid);
          return;
        }
        state.finish = async () => {
          lease.current = await openReportCalendarCandidate(
            binding,
            calendarReader,
            signal,
          );
          if (signal?.aborted) return;
          await transaction(async final => {
            const current = await readmitted(final);
            if (!current) return;
            await finish(final, current.invalid);
          });
        };
      });
      if (signal?.aborted) return { status: 'error' };
      await state.finish?.();
      if (signal?.aborted) return { status: 'error' };
      const completed = result as DailyReportLookup;
      if (
        completed.status === 'saved' &&
        completed.context.systemCalendar &&
        !lease.current?.isCurrent()
      ) {
        await invalidateDailyReportRun(database, completed.runId);
        return {
          status: 'stale',
          runId: completed.runId,
          revision: completed.revision,
          sourceStatus: 'stale',
        };
      }
      return completed;
    } catch {
      return { status: 'error' };
    } finally {
      lease.current?.dispose();
    }
  };
}
