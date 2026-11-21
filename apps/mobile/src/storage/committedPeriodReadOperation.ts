import {
  reportCacheDecision,
  endReportCalculationDiagnostic,
} from '../healthEvidence/healthContext/reportCalculationDiagnostic';
import { healthContextReportCacheKey } from '../healthEvidence/healthContext/reportCacheKey';
import {
  createCommittedReportScope,
  committedReportCache,
  committedReportCalendar,
  immutableReportSnapshot,
} from '../healthEvidence/healthContext/committedReportScope';
import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import type { HealthContextReport } from '../healthEvidence/healthContext/types';
import { readHealthContextReport } from '../healthEvidence/healthContext/reader';
import { readHealthContextGeneration } from '../healthEvidence/healthContext/generation';
import {
  assertSummaryPeriodReport,
  assertSummaryPeriodCurrent,
} from './symptomSummaryPeriods';
import type { ReadOnlyPeriodValidation } from './readOnlyPeriodValidation';
import { nativeHeartWorkoutPrefix } from '../healthEvidence/healthContext/heartWorkoutPrefix';
import {
  historyValidationCostEnabled,
  measureHistoryValidationCost,
  startHistoryValidationCost,
} from '../providers/conversationHistoryDiagnostic';

/** Scope invalidation must not undo unrelated native writes on this connection. */
class ReadScopeInvalidated extends Error {}

type Pair = Awaited<ReturnType<typeof readHealthContextGeneration>>;
const same = (a: Pair, b: Pair) =>
  a.mutationGeneration === b.mutationGeneration &&
  a.deletionGeneration === b.deletionGeneration;

/** Owned by one production DB reader. Only committed report values cross read
 * transactions; parent, policy, marker and source-validity checks never do. */
export function committedPeriodReadOperation(
  database: SqlDatabase,
  signal?: AbortSignal,
  historyPage = false,
) {
  const reportScope = createCommittedReportScope(database);
  const reports = committedReportCache(reportScope.token, database)!;
  const calendar = committedReportCalendar(reportScope.token, database)!;
  const profilePeriodTransaction = historyValidationCostEnabled();
  const profileHistoryValidation = historyPage && profilePeriodTransaction;
  let disposed = false;
  const cancel = () => {
    calendar.dispose();
    reports.clear();
    endReportCalculationDiagnostic(reports);
  };
  const dispose = () => {
    disposed = true;
    reportScope.dispose();
    signal?.removeEventListener('abort', cancel);
  };
  if (signal?.aborted) cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  const check = () => {
    if (signal?.aborted)
      throw new ReadScopeInvalidated('Conversation read was cancelled.');
  };
  return {
    reportScope: reportScope.token,
    profileHistoryValidation,
    dispose,
    get active() {
      return !disposed;
    },
    async run(
      work: (
        tx: SqlExecutor,
        validate: ReadOnlyPeriodValidation,
      ) => Promise<void>,
      options: {
        rollbackOnFailure?: boolean;
        /** Only the canonical, still-owned bound reader can opt into this plan. */
        boundQuantityOwner?: () => boolean;
      } = {},
    ) {
      check();
      const pending = new Map<string, HealthContextReport>();
      let failure: { error: unknown } | undefined;
      let endTransaction:
        ReturnType<typeof startHistoryValidationCost> | undefined;
      const read = async (tx: SqlExecutor) => {
        // One aggregate span per owned transaction: after acquisition through
        // SQLite settlement, before the separate publication-generation check.
        if (profilePeriodTransaction)
          endTransaction = startHistoryValidationCost(
            'artifact_period_transaction',
          );
        // Check cancellation at every query boundary without converting operational
        // SQL errors into cancellation. The report's generic abort errors must not
        // accidentally select rollback and resurrect an interleaved native delete.
        const reportExecutor: SqlExecutor = {
          execute: async (...args) => {
            check();
            const result = await tx.execute(...args);
            check();
            return result;
          },
        };
        // The history-page workspace retains its own separately gated TEMP
        // prefix. Bound capture borrows only the read-only quantity expression.
        const measureCost = profileHistoryValidation
          ? measureHistoryValidationCost
          : undefined;
        let supportsOrderedAggregate: boolean | undefined;
        const owner = options.boundQuantityOwner;
        const restorationWorkspace = historyPage
          ? {
              acquireHeartPrefix: nativeHeartWorkoutPrefix(reportExecutor, tx),
              measureCost,
            }
          : owner
            ? {
                indexedQuantity: async (
                  days: number,
                  family: 'all' | 'measurements' | 'activity',
                ) => {
                  // The index plan pays a latest-row seek per daily group.
                  // Keep short/other scopes and unsupported engines on the original sweep.
                  if (days < 7 || family !== 'measurements' || !owner())
                    return false;
                  if (supportsOrderedAggregate === undefined) {
                    const result = await reportExecutor.execute(
                      'SELECT sqlite_version() AS version',
                    );
                    const version = result.rows[0]?.version;
                    const match =
                      typeof version === 'string' &&
                      /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
                    supportsOrderedAggregate = Boolean(
                      match &&
                      (Number(match[1]) > 3 ||
                        (Number(match[1]) === 3 && Number(match[2]) >= 44)),
                    );
                  }
                  return supportsOrderedAggregate && owner();
                },
              }
            : undefined;
        const validate: ReadOnlyPeriodValidation = async (
          executor,
          source,
          required,
        ) => {
          if (executor !== tx) {
            await assertSummaryPeriodCurrent(executor, source, required);
            return;
          }
          check();
          const before = await readHealthContextGeneration(tx);
          check();
          const key = healthContextReportCacheKey(source.scope.window, [
            source.scope.topic,
          ]);
          // Pending reports belong only to this transaction. Reuse calculation,
          // not validity: every source still checks live generations and revision.
          const cached = pending.get(key) ?? reports.get(key);
          reportCacheDecision(
            cached && same(cached, before)
              ? pending.has(key)
                ? 'pending_hit'
                : 'committed_hit'
              : cached
                ? 'generation_miss'
                : 'new_key',
          );
          // The transaction owns this immutable snapshot. Freeze before the
          // first comparison so later checks can reuse the same pure digest.
          let report = cached && same(cached, before) ? cached : undefined;
          if (!report) {
            const calculated = await readHealthContextReport(
              reportExecutor,
              source.scope.window,
              [source.scope.topic],
              undefined,
              undefined,
              reports,
              calendar,
              restorationWorkspace,
            );
            report = measureCost
              ? measureCost('artifact_report_snapshot', () =>
                  immutableReportSnapshot(calculated),
                )
              : immutableReportSnapshot(calculated);
          }
          const after = await readHealthContextGeneration(tx);
          check();
          if (!same(before, report) || !same(after, report))
            throw new ReadScopeInvalidated(
              'Health context changed during validation.',
            );
          if (measureCost) {
            const current = report;
            measureCost('artifact_report_fingerprint', () =>
              assertSummaryPeriodReport(source, current, required),
            );
          } else assertSummaryPeriodReport(source, report, required);
          pending.set(key, report);
        };
        try {
          await work(tx, validate);
          check();
        } catch (error) {
          // Tool snapshots explicitly retain their existing rollback contract.
          if (
            options.rollbackOnFailure &&
            !(error instanceof ReadScopeInvalidated)
          )
            throw error;
          // Other read callers can observe native direct writes on this connection.
          // Keep their established behavior: do not roll back those writes or
          // non-destructive quarantine audit state merely because the read fails.
          failure = { error };
        }
      };
      try {
        await database.transaction(read);
        endTransaction?.(failure ? 'failed' : 'completed');
      } catch (error) {
        endTransaction?.('failed');
        throw error;
      }
      if (failure) throw failure.error;
      check();
      const committed = await readHealthContextGeneration(database);
      check();
      for (const report of pending.values())
        if (!same(report, committed))
          throw new Error('Health context changed before read publication.');
      if (!disposed)
        for (const [key, report] of pending) reports.set(key, report);
    },
  };
}
