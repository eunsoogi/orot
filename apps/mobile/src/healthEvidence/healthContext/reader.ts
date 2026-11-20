import { reportCacheDecision } from './reportCalculationDiagnostic';
import { healthContextReportCacheKey } from './reportCacheKey';
import { immutableReportSnapshot } from './committedReportScope';
import { registerHealthContextReadOwner } from './healthContextReadOperation';
import type { SqlDatabase } from '@orot/storage';
import {
  readHealthContextGeneration,
  ensureHealthContextGeneration,
} from './generation';
import type {
  HealthContextReport,
  HealthContextTopic,
  HealthContextWindow,
} from './types';
import { HEALTH_CONTEXT_TOPICS } from './types';
import {
  traceHealthContext,
  traceHealthContextScheduler,
  type HealthContextTrace,
} from './trace';
import {
  readHealthContextCalendar,
  type HealthContextCalendarScope,
} from './calendarReadScope';
import { healthContextCalendarParameter } from './calendarSql';
import { readHealthContextReport as calculateHealthContextReport } from './healthContextReport';
// Preserve the original exported callable boundary for adapters and diagnostics.
export const readHealthContextReport = calculateHealthContextReport;

export type HealthContextReader = (
  window: HealthContextWindow,
  topics: readonly HealthContextTopic[],
  signal?: AbortSignal,
  trace?: HealthContextTrace,
) => Promise<HealthContextReport>;

/** One bounded report per health topic may be reused only while the protected dataset generation remains current. */
export function createHealthContextReader(
  database: SqlDatabase,
): HealthContextReader {
  let ready: Promise<void> | undefined;
  const createRead =
    (
      cache: Map<string, HealthContextReport>,
      maxEntries?: number,
      calendar?: HealthContextCalendarScope,
    ): HealthContextReader =>
    async (window, topics, signal, trace) => {
      trace?.('preparation', 'started');
      ready ??= database
        // Standalone source restoration must preserve the same privacy boundary as the local evidence adapter.
        .execute('PRAGMA temp_store = MEMORY')
        .then(() => database.transaction(ensureHealthContextGeneration))
        .catch(error => {
          ready = undefined;
          throw error;
        });
      await ready;
      trace?.('preparation', 'completed');
      if (signal?.aborted) throw new Error('Health context was cancelled.');
      // The binding and the later generation-fenced SQL must use the same values,
      // even if the caller changes its request while the transaction is queued.
      const prepareMeasurements =
        topics.length === 1 && topics[0] === 'measurements';
      if (prepareMeasurements) {
        window = {
          ...window,
          ...(window.doseHistory
            ? { doseHistory: { ...window.doseHistory } }
            : {}),
        };
        topics = ['measurements'];
      }
      const key = healthContextReportCacheKey(window, topics);
      const current = await traceHealthContext(trace, 'generation', () =>
        readHealthContextGeneration(database),
      );
      const cached = cache.get(key);
      if (signal?.aborted) throw new Error('Health context was cancelled.');
      reportCacheDecision(
        cached && sameGeneration(cached, current)
          ? 'committed_hit'
          : cached
            ? 'generation_miss'
            : 'new_key',
      );
      if (cached && sameGeneration(cached, current)) return cached;
      // Calendar instants and their bound text do not depend on records or generation.
      // Keep that pure work out of the shared transaction and reuse the key binding.
      const preparedCalendar = prepareMeasurements
        ? (() => {
            trace?.('calendar', 'started');
            const days = readHealthContextCalendar(calendar, window);
            const timestampKeys = healthContextCalendarParameter(days);
            trace?.('calendar', 'completed');
            return { days, timestampKeys };
          })()
        : undefined;
      if (signal?.aborted) throw new Error('Health context was cancelled.');
      let report: HealthContextReport | undefined;
      let failure: { error: unknown } | undefined;
      // The native adapter queues transactions; distinguish that wait from the report queries.
      trace?.('transaction_wait', 'started');
      const stopProbe = traceHealthContextScheduler(trace);
      try {
        await database.transaction(async tx => {
          stopProbe();
          trace?.('transaction_wait', 'completed');
          try {
            const before = await readHealthContextGeneration(tx);
            if (signal?.aborted)
              throw new Error('Health context was cancelled.');
            report = await readHealthContextReport(
              tx,
              window,
              topics,
              signal,
              trace,
              cache,
              calendar,
              undefined,
              preparedCalendar,
            );
            const after = await readHealthContextGeneration(tx);
            if (signal?.aborted)
              throw new Error('Health context was cancelled.');
            if (
              !sameGeneration(before, report) ||
              !sameGeneration(after, report)
            )
              throw new Error('Health context changed during aggregation.');
          } catch (error) {
            // These queries are read-only. Report invalidation after commit so a
            // same-connection write interleaved by the native adapter is not undone.
            failure = { error };
          }
        });
      } finally {
        stopProbe();
      }
      if (failure) throw failure.error;
      if (!report) throw new Error('Health context could not be read.');
      // A rolled-back transaction must never publish a cache entry. The adapter
      // resolves only after commit; recheck outside it before reuse/publication.
      const committed = await readHealthContextGeneration(database);
      if (signal?.aborted) throw new Error('Health context was cancelled.');
      if (!sameGeneration(report, committed))
        throw new Error('Health context changed before publication.');
      cache.delete(key);
      cache.set(key, immutableReportSnapshot(report));
      if (maxEntries !== undefined && cache.size > maxEntries)
        cache.delete(cache.keys().next().value!);
      return report;
    };
  const baseCache = new Map<string, HealthContextReport>();
  const reader = createRead(baseCache, HEALTH_CONTEXT_TOPICS.length);
  registerHealthContextReadOwner(reader, database, (cache, calendar) => {
    // Copy only committed bounded entries. Each scoped hit still checks live
    // generations and cancellation; scoped results never flow back to baseCache.
    for (const [key, report] of baseCache)
      if (!cache.has(key)) cache.set(key, report);
    return createRead(cache, undefined, calendar);
  });
  return reader;
}

function sameGeneration(
  left: { mutationGeneration: number; deletionGeneration: number },
  right: { mutationGeneration: number; deletionGeneration: number },
) {
  return (
    left.mutationGeneration === right.mutationGeneration &&
    left.deletionGeneration === right.deletionGeneration
  );
}
