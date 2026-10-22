import type { HealthContextReport, HealthQuantityDay } from './types';
import { projectHealthMedication } from './medicationProjection';

export type HealthContextDetail = 'summary' | 'weekly' | 'daily';
const round = (value: number) => Math.round(value * 100) / 100;
const average = (values: readonly number[]) =>
  values.length
    ? round(values.reduce((a, b) => a + b, 0) / values.length)
    : null;

function quantities(days: readonly HealthQuantityDay[], step: boolean) {
  const last = days.at(-1);
  return {
    recordedDays: days.length,
    sampleCount: days.reduce((sum, day) => sum + day.samples, 0),
    minimumSample: days.length
      ? Math.min(...days.map(day => day.minimum))
      : null,
    maximumSample: days.length
      ? Math.max(...days.map(day => day.maximum))
      : null,
    meanOfRecordedDailyMeans: step
      ? undefined
      : average(days.map(day => day.mean)),
    meanRecordedDailySampleSum: step
      ? average(days.map(day => day.sum))
      : undefined,
    latest: last ? { amount: last.latest, occurredAt: last.lastAt } : null,
  };
}

/** Remove storage identities and name each calculation explicitly, without inventing clinical conclusions. */
export function projectHealthContext(
  report: HealthContextReport,
  detail: HealthContextDetail = 'summary',
) {
  const dates = report.days.map(day => day.date);
  const completeDates = report.days
    .filter(day => !day.partial)
    .map(day => day.date);
  const weeks = Array.from(
    { length: Math.ceil(dates.length / 7) },
    (_, index) => dates.slice(index * 7, index * 7 + 7),
  );
  const asleepDays = report.sleep.filter(day => day.asleepSeconds > 0);
  return {
    period: report.window,
    calendarDays: dates.length,
    partialDates: report.days.filter(day => day.partial).map(day => day.date),
    quantities: report.quantities.map((series, index) => {
      const step = series.concept === 'step_count';
      const complete = series.days.filter(day =>
        completeDates.includes(day.date),
      );
      const recent = complete.filter(day =>
        completeDates.slice(-7).includes(day.date),
      );
      const previous = complete.filter(day =>
        completeDates.slice(-14, -7).includes(day.date),
      );
      const means = (days: readonly HealthQuantityDay[]) =>
        average(days.map(day => (step ? day.sum : day.mean)));
      const before = means(previous),
        after = means(recent);
      return {
        concept: series.concept,
        unit: series.unit,
        sensorSeries: index + 1,
        semantics: step
          ? 'separate_sensor_sample_sums_not_merged_health_daily_totals'
          : 'separate_sensor_daily_measurements',
        ...quantities(series.days, step),
        missingCalendarDays: dates.length - series.days.length,
        comparison: {
          method: step ? 'mean_of_daily_sample_sums' : 'mean_of_daily_means',
          previousDates: completeDates.slice(-14, -7),
          recentDates: completeDates.slice(-7),
          previousRecordedDays: previous.length,
          recentRecordedDays: recent.length,
          previousMean: before,
          recentMean: after,
          difference:
            before !== null && after !== null ? round(after - before) : null,
        },
        ...(detail === 'weekly'
          ? {
              weeks: weeks.map(week => ({
                fromDate: week[0],
                toDate: week.at(-1),
                ...quantities(
                  series.days.filter(day => week.includes(day.date)),
                  step,
                ),
              })),
            }
          : {}),
        ...(detail === 'daily'
          ? {
              days: series.days.map(day => ({
                ...day,
                mean: round(day.mean),
                sum: round(day.sum),
              })),
            }
          : {}),
      };
    }),
    medications: report.medications.map(projectHealthMedication),
    sleep: {
      semantics:
        'observed_asleep_interval_union_by_calendar_day_not_complete_nights',
      recordedDays: asleepDays.length,
      missingCalendarDays: dates.length - asleepDays.length,
      meanRecordedDailyMinutes: average(
        asleepDays.map(day => day.asleepSeconds / 60),
      ),
      stageMinutes: Object.fromEntries(
        [...new Set(report.sleep.flatMap(day => Object.keys(day.stages)))]
          .sort()
          .map(stage => [
            stage,
            round(
              report.sleep.reduce(
                (sum, day) => sum + (day.stages[stage] ?? 0),
                0,
              ) / 60,
            ),
          ]),
      ),
      overlappingStageMinutes: round(
        report.sleep.reduce(
          (sum, day) => sum + day.overlappingStageSeconds,
          0,
        ) / 60,
      ),
      ...(detail === 'summary'
        ? {}
        : {
            days: report.sleep.map(day => ({
              date: day.date,
              minutes: round(day.asleepSeconds / 60),
              stages: day.stages,
            })),
          }),
    },
    symptoms: report.symptoms,
    limitations: [
      ...report.limitations,
      'unrecorded_days_are_unknown_not_zero_or_missed_doses',
      'medication_registration_and_current_confirmation_are_distinct_from_individual_dose_completion',
      ...(report.quantities.some(series => series.concept === 'step_count')
        ? [
            'sensor_step_sample_sums_may_overlap_do_not_add_series_or_infer_complete_daily_totals',
          ]
        : []),
    ],
  };
}
