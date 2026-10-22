import type { EvidenceItem } from '@orot/agent-runtime';

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const number = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Repeat only the app-computed quantity semantics as a generation checklist. Originals
 * stay in the normal task messages and remain the sole citation/validation authority.
 * No new measurements, calculations or complete-night/daily-total claims are inferred here. */
export function appleSummaryFactChecklist(items: readonly EvidenceItem[]) {
  return items.flatMap(item => {
    if (
      item.sourceKind !== 'personal_record' ||
      !item.content.startsWith('health_context: ')
    )
      return [];
    try {
      const value: unknown = JSON.parse(
        item.content.slice('health_context: '.length),
      );
      if (!object(value)) return [];
      const quantities = (
        Array.isArray(value.quantities) ? value.quantities : []
      )
        .filter(object)
        .filter(
          series =>
            typeof series.concept === 'string' &&
            typeof series.unit === 'string',
        )
        .map(series => {
          const step = series.concept === 'step_count';
          const mean = step
            ? series.meanRecordedDailySampleSum
            : series.meanOfRecordedDailyMeans;
          return {
            concept: series.concept,
            sensorSeries: series.sensorSeries,
            unit: step && series.unit === 'count' ? 'steps' : series.unit,
            ...(number(mean)
              ? {
                  recordedDayMean: {
                    amount: mean,
                    statistic: step
                      ? 'mean_of_daily_sensor_sample_sums_not_a_merged_daily_total'
                      : 'mean_of_recorded_daily_means',
                  },
                }
              : {}),
            sampleCountNotMeasurementAmount: series.sampleCount,
            recordedDays: series.recordedDays,
            missingCalendarDays: series.missingCalendarDays,
            ...(object(series.latest) && number(series.latest.amount)
              ? { latestMeasurement: series.latest }
              : {}),
          };
        });
      const sleep =
        object(value.sleep) && number(value.sleep.meanRecordedDailyMinutes)
          ? {
              recordedCalendarDayMeanMinutes:
                value.sleep.meanRecordedDailyMinutes,
              recordedDays: value.sleep.recordedDays,
              missingCalendarDays: value.sleep.missingCalendarDays,
              stageTotalMinutesOverWholePeriod: value.sleep.stageMinutes,
              overlappingStageMinutes: value.sleep.overlappingStageMinutes,
              completeNightTotal: false,
            }
          : undefined;
      return quantities.length || sleep
        ? [
            {
              evidenceId: item.evidenceId,
              ...(quantities.length ? { quantities } : {}),
              ...(sleep ? { sleep } : {}),
            },
          ]
        : [];
    } catch {
      // Unknown source formats retain their original content; never manufacture fallback facts.
      return [];
    }
  });
}
