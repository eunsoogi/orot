import { observeReportAggregateSql } from './reportCalculationDiagnostic';
import type { SqlExecutor } from '@orot/storage';
import { readHealthContextGeneration } from './generation';
import { readHealthQuantityContext } from './quantityQuery';
import { addHeartRateActivityContext } from './heartRateActivity';
import { readHealthMedicationContext } from './medicationQuery';
import { readDoseHistory } from './doseHistoryQuery';
import { readHealthSleepContext } from './sleepQuery';
import { readHealthSymptomContext } from './symptomQuery';
import type {
  HealthContextReport,
  HealthContextTopic,
  HealthContextWindow,
} from './types';
import { HEALTH_CONTEXT_TOPICS } from './types';
import { traceHealthContext, type HealthContextTrace } from './trace';

import {
  withHealthContextCalendar,
  type HealthContextCalendarScope,
} from './calendarReadScope';
/** Reusable inside an existing transaction: no nested transactions, raw history transfer or implicit native reads. */
export async function readHealthContextReport(
  executor: SqlExecutor,
  window: HealthContextWindow,
  topics: readonly HealthContextTopic[],
  signal?: AbortSignal,
  trace?: HealthContextTrace,
  diagnosticOwner?: object,
  calendarScope?: HealthContextCalendarScope,
): Promise<HealthContextReport> {
  return withHealthContextCalendar(calendarScope, async calendar => {
    executor = observeReportAggregateSql(executor, diagnosticOwner);
    if (signal?.aborted) throw new Error('Health context was cancelled.');
    if (
      !topics.length ||
      topics.some(topic => !HEALTH_CONTEXT_TOPICS.includes(topic))
    )
      throw new RangeError('Invalid health context topics.');
    trace?.('calendar', 'started');
    const days = calendar.read(window);
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
          readHealthMedicationContext(executor, window, signal, calendar),
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
        ...(quantities.truncated
          ? ['quantity_sensor_series_limit_reached']
          : []),
        ...(medications.truncated ? ['medication_catalog_limit_reached'] : []),
        ...(sleep.unsupportedCategories
          ? ['unsupported_sleep_categories_excluded_from_duration']
          : []),
      ],
      ...(await readHealthContextGeneration(executor)),
    };
  });
}
