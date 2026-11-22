import { observeReportAggregateSql } from './reportCalculationDiagnostic';
import type { SqlExecutor } from '@orot/storage';
import { readHealthContextGeneration } from './generation';
import { readHealthQuantityContext } from './quantityQuery';
import { addHeartRateActivityContext } from './heartRateActivity';
import type { AcquireHeartWorkoutPrefix } from './heartWorkoutPrefix';
import { readHealthMedicationContext } from './medicationQuery';
import { readDoseHistory } from './doseHistoryQuery';
import { readHealthSleepContext } from './sleepQuery';
import { readHealthSymptomContext } from './symptomQuery';
import type {
  HealthContextReport,
  HealthContextTopic,
  HealthContextWindow,
  HealthQuantityDay,
  HealthQuantitySeries,
} from './types';
import { HEALTH_CONTEXT_TOPICS } from './types';
import { traceHealthContext, type HealthContextTrace } from './trace';
import type { measureHistoryValidationCost } from '../../providers/conversationHistoryDiagnostic';

import {
  withHealthContextCalendar,
  type HealthContextCalendarScope,
} from './calendarReadScope';
type ChartQuantitySeries = Omit<HealthQuantitySeries, 'days'> & {
  readonly days: readonly Omit<HealthQuantityDay, 'activityContext'>[];
};

export type OverviewChartHealthContext = Pick<
  HealthContextReport,
  'window' | 'days' | 'sleep' | 'limitations'
> & { readonly quantities: readonly ChartQuantitySeries[] };

type ReportInputs = [
  executor: SqlExecutor,
  window: HealthContextWindow,
  topics: readonly HealthContextTopic[],
  signal?: AbortSignal,
  trace?: HealthContextTrace,
  diagnosticOwner?: object,
  calendarScope?: HealthContextCalendarScope,
  restorationWorkspace?: {
    acquireHeartPrefix?: AcquireHeartWorkoutPrefix;
    indexedQuantity?: (
      calendarDays: number,
      family: 'all' | 'measurements' | 'activity',
    ) => Promise<boolean>;
    measureCost?: typeof measureHistoryValidationCost;
  },
  preparedCalendar?: {
    readonly days: HealthContextReport['days'];
    readonly timestampKeys: string;
  },
];

/** Local chart values do not display per-sample workout-overlap groups. Read them
 * from the same aggregate snapshot without calculating that AI-only context. */
export function readOverviewChartHealthContext(
  executor: SqlExecutor,
  window: HealthContextWindow,
): Promise<OverviewChartHealthContext> {
  return readHealthContext('overviewCharts', executor, window, [
    'measurements',
    'activity',
    'sleep',
  ]);
}

/** Reusable inside an existing transaction: no nested transactions, raw history transfer or implicit native reads. */
export function readHealthContextReport(
  ...inputs: ReportInputs
): Promise<HealthContextReport> {
  return readHealthContext('full', ...inputs);
}

async function readHealthContext(
  purpose: 'full' | 'overviewCharts',
  ...[
    executor,
    window,
    topics,
    signal,
    trace,
    diagnosticOwner,
    calendarScope,
    restorationWorkspace,
    preparedCalendar,
  ]: ReportInputs
): Promise<HealthContextReport> {
  return withHealthContextCalendar(calendarScope, async calendar => {
    executor = observeReportAggregateSql(executor, diagnosticOwner);
    if (signal?.aborted) throw new Error('Health context was cancelled.');
    if (
      !topics.length ||
      topics.some(topic => !HEALTH_CONTEXT_TOPICS.includes(topic))
    )
      throw new RangeError('Invalid health context topics.');
    if (!preparedCalendar) trace?.('calendar', 'started');
    const days =
      preparedCalendar?.days ??
      (restorationWorkspace?.measureCost
        ? restorationWorkspace.measureCost('artifact_report_calendar', () =>
            calendar.read(window),
          )
        : calendar.read(window));
    if (!preparedCalendar) trace?.('calendar', 'completed');
    const selected = new Set(topics);
    const quantities =
      selected.has('measurements') || selected.has('activity')
        ? await traceHealthContext(trace, 'quantities', async () => {
            const family =
              selected.has('activity') && selected.has('measurements')
                ? 'all'
                : selected.has('activity')
                  ? 'activity'
                  : 'measurements';
            const indexed = restorationWorkspace?.indexedQuantity
              ? await restorationWorkspace.indexedQuantity(days.length, family)
              : Boolean(restorationWorkspace);
            const result = await readHealthQuantityContext(
              executor,
              days,
              signal,
              family,
              window.dataAvailableThrough,
              indexed,
              preparedCalendar?.timestampKeys,
            );
            if (purpose === 'overviewCharts') return result;
            return {
              ...result,
              series: await addHeartRateActivityContext(
                executor,
                days,
                result.series,
                signal,
                window.dataAvailableThrough,
                restorationWorkspace?.acquireHeartPrefix,
                preparedCalendar?.timestampKeys,
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
