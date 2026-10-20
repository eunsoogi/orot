import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import {
  readHealthContextGeneration,
  ensureHealthContextGeneration,
} from './generation';
import { readHealthQuantityContext } from './quantityQuery';
import { readHealthMedicationContext } from './medicationQuery';
import { readHealthSleepContext } from './sleepQuery';
import { readHealthSymptomContext } from './symptomQuery';
import { healthContextDays } from './window';
import type {
  HealthContextReport,
  HealthContextTopic,
  HealthContextWindow,
} from './types';
import { HEALTH_CONTEXT_TOPICS } from './types';
import { traceHealthContext, type HealthContextTrace } from './trace';

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
      ? await traceHealthContext(trace, 'quantities', () =>
          readHealthQuantityContext(
            executor,
            days,
            signal,
            selected.has('activity') && selected.has('measurements')
              ? 'all'
              : selected.has('activity')
                ? 'activity'
                : 'measurements',
          ),
        )
      : { series: [], truncated: false };
  const medications = selected.has('medications')
    ? await traceHealthContext(trace, 'medications', () =>
        readHealthMedicationContext(executor, window, signal),
      )
    : { medications: [], truncated: false };
  const sleep = selected.has('sleep')
    ? await traceHealthContext(trace, 'sleep', () =>
        readHealthSleepContext(executor, days, signal),
      )
    : { days: [], unsupportedCategories: false };
  const symptoms = selected.has('symptoms')
    ? await traceHealthContext(trace, 'symptoms', () =>
        readHealthSymptomContext(executor, days),
      )
    : { entryCount: 0, recordedDays: 0, latest: [] };
  if (signal?.aborted) throw new Error('Health context was cancelled.');
  return {
    window,
    days,
    quantities: quantities.series.filter(series =>
      series.concept === 'step_count'
        ? selected.has('activity')
        : selected.has('measurements'),
    ),
    medications: medications.medications,
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
  const cache = new Map<string, HealthContextReport>();
  return async (window, topics, signal, trace) => {
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
    const current = await readHealthContextGeneration(database);
    const cached = cache.get(key);
    if (cached?.mutationGeneration === current.mutationGeneration)
      return cached;
    let report: HealthContextReport | undefined;
    await database.transaction(async tx => {
      report = await readHealthContextReport(tx, window, topics, signal, trace);
    });
    if (!report) throw new Error('Health context could not be read.');
    cache.delete(key);
    cache.set(key, report);
    if (cache.size > HEALTH_CONTEXT_TOPICS.length)
      cache.delete(cache.keys().next().value!);
    return report;
  };
}
