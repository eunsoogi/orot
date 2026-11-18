import { registerHealthContextReadOwner } from './healthContextReadOperation';
import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import {
  readHealthContextGeneration,
  ensureHealthContextGeneration,
} from './generation';
import { readHealthQuantityContext } from './quantityQuery';
import { addHeartRateActivityContext } from './heartRateActivity';
import { readHealthMedicationContext } from './medicationQuery';
import { readDoseHistory } from './doseHistoryQuery';
import { readHealthSleepContext } from './sleepQuery';
import { readHealthSymptomContext } from './symptomQuery';
import { healthContextDays } from './window';
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

export type HealthContextReader = (
  window: HealthContextWindow,
  topics: readonly HealthContextTopic[],
  signal?: AbortSignal,
  trace?: HealthContextTrace,
) => Promise<HealthContextReport>;

/** Reusable inside an existing transaction: no nested transactions, raw history transfer or implicit native reads. */
export async function readHealthContextReport(
  executor: SqlExecutor,
  window: HealthContextWindow,
  topics: readonly HealthContextTopic[],
  signal?: AbortSignal,
  trace?: HealthContextTrace,
): Promise<HealthContextReport> {
  if (signal?.aborted) throw new Error('Health context was cancelled.');
  if (
    !topics.length ||
    topics.some(topic => !HEALTH_CONTEXT_TOPICS.includes(topic))
  )
    throw new RangeError('Invalid health context topics.');
  trace?.('calendar', 'started');
  const days = healthContextDays(window);
  trace?.('calendar', 'completed');
  const selected = new Set(topics);
  const quantities =
    selected.has('measurements') || selected.has('activity')
      ? await traceHealthContext(trace, 'quantities', async () => {
          const result = await readHealthQuantityContext(
            executor,
            days,
            signal,
            selected.has('activity') && selected.has('measurements')
              ? 'all'
              : selected.has('activity')
                ? 'activity'
                : 'measurements',
            window.dataAvailableThrough,
          );
          return {
            ...result,
            series: await addHeartRateActivityContext(
              executor,
              days,
              result.series,
              signal,
              window.dataAvailableThrough,
            ),
          };
        })
      : { series: [], truncated: false };
  const medications = selected.has('medications')
    ? await traceHealthContext(trace, 'medications', () =>
        readHealthMedicationContext(executor, window, signal),
      )
    : { medications: [], truncated: false };
  const sleep = selected.has('sleep')
    ? await traceHealthContext(trace, 'sleep', () =>
        readHealthSleepContext(
          executor,
          days,
          signal,
          window.dataAvailableThrough,
        ),
      )
    : { days: [], unsupportedCategories: false };
  const symptoms = selected.has('symptoms')
    ? await traceHealthContext(trace, 'symptoms', () =>
        readHealthSymptomContext(executor, days, window.dataAvailableThrough),
      )
    : { entryCount: 0, recordedDays: 0, latest: [] };
  if (signal?.aborted) throw new Error('Health context was cancelled.');
  return {
    window,
    days,
    quantities: quantities.series.filter(series =>
      series.concept === 'step_count' || series.concept === 'workout_duration'
        ? selected.has('activity')
        : selected.has('measurements'),
    ),
    medications: medications.medications,
    ...(selected.has('medications') && window.doseHistory
      ? { doseHistory: await readDoseHistory(executor, window) }
      : {}),
    sleep: sleep.days,
    symptoms,
    limitations: [
      ...(quantities.truncated ? ['quantity_sensor_series_limit_reached'] : []),
      ...(medications.truncated ? ['medication_catalog_limit_reached'] : []),
      ...(sleep.unsupportedCategories
        ? ['unsupported_sleep_categories_excluded_from_duration']
        : []),
    ],
    ...(await readHealthContextGeneration(executor)),
  };
}

/** One bounded report per health topic may be reused only while the protected dataset generation remains current. */
export function createHealthContextReader(
  database: SqlDatabase,
): HealthContextReader {
  let ready: Promise<void> | undefined;
  const createRead =
    (
      cache: Map<string, HealthContextReport>,
      maxEntries?: number,
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
      const key = JSON.stringify([window, [...new Set(topics)].sort()]);
      const current = await traceHealthContext(trace, 'generation', () =>
        readHealthContextGeneration(database),
      );
      const cached = cache.get(key);
      if (signal?.aborted) throw new Error('Health context was cancelled.');
      if (cached && sameGeneration(cached, current)) return cached;
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
      cache.set(key, report);
      if (maxEntries !== undefined && cache.size > maxEntries)
        cache.delete(cache.keys().next().value!);
      return report;
    };
  const baseCache = new Map<string, HealthContextReport>();
  const reader = createRead(baseCache, HEALTH_CONTEXT_TOPICS.length);
  registerHealthContextReadOwner(reader, cache => {
    // Copy only committed bounded entries. Each scoped hit still checks live
    // generations and cancellation; scoped results never flow back to baseCache.
    for (const [key, report] of baseCache) cache.set(key, report);
    return createRead(cache);
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
