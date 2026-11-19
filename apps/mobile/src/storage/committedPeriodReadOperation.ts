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
) {
  const reportScope = createCommittedReportScope(database);
  const reports = committedReportCache(reportScope.token, database)!;
  const calendar = committedReportCalendar(reportScope.token, database)!;
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
    dispose,
    get active() {
      return !disposed;
    },
    async run(
      work: (
        tx: SqlExecutor,
        validate: ReadOnlyPeriodValidation,
      ) => Promise<void>,
      options: { rollbackOnFailure?: boolean } = {},
    ) {
      check();
      const pending = new Map<string, HealthContextReport>();
      let failure: { error: unknown } | undefined;
      await database.transaction(async tx => {
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
        const restorationWorkspace = {
          acquireHeartPrefix: nativeHeartWorkoutPrefix(reportExecutor, tx),
        };
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
          const report =
            cached && same(cached, before)
              ? cached
              : immutableReportSnapshot(
                  await readHealthContextReport(
                    reportExecutor,
                    source.scope.window,
                    [source.scope.topic],
                    undefined,
                    undefined,
                    reports,
                    calendar,
                    restorationWorkspace,
                  ),
                );
          const after = await readHealthContextGeneration(tx);
          check();
          if (!same(before, report) || !same(after, report))
            throw new ReadScopeInvalidated(
              'Health context changed during validation.',
            );
          assertSummaryPeriodReport(source, report, required);
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
      });
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
