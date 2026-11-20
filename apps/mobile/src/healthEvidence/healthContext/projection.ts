import type {
  HealthContextReport,
  HealthQuantityDay,
  HeartRateActivityGroup,
} from './types';
import { projectHealthMedication } from './medicationProjection';

export type HealthContextDetail = 'summary' | 'weekly' | 'daily';
const round = (value: number) => Math.round(value * 100) / 100;
const average = (values: readonly number[]) =>
  values.length
    ? round(values.reduce((a, b) => a + b, 0) / values.length)
    : null;

/** Keep activity strata descriptive; never discard an elevated sample or relabel unmatched samples as resting. */
function activityGroups(
  days: readonly HealthQuantityDay[],
): HeartRateActivityGroup[] {
  const groups = new Map<
    HeartRateActivityGroup['context'],
    HeartRateActivityGroup
  >();
  for (const group of days.flatMap(day => day.activityContext ?? [])) {
    const previous = groups.get(group.context);
    groups.set(
      group.context,
      previous
        ? {
            context: group.context,
            samples: previous.samples + group.samples,
            minimum: Math.min(previous.minimum, group.minimum),
            maximum: Math.max(previous.maximum, group.maximum),
          }
        : group,
    );
  }
  return [...groups.values()].sort((a, b) =>
    a.context.localeCompare(b.context),
  );
}

function quantities(days: readonly HealthQuantityDay[], step: boolean) {
  const last = days.at(-1);
  return {
    ...(days.some(day => day.activityContext)
      ? { activityContext: activityGroups(days) }
      : {}),
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
  const recentDates = completeDates.slice(-7);
  const previousDates = completeDates.slice(-14, -7);
  // Only the two comparison windows need membership checks. Build their date
  // sets once, without scanning the full calendar for every reported sample day.
  const recentDateSet = new Set(recentDates);
  const previousDateSet = new Set(previousDates);
  const weeks =
    detail === 'weekly'
      ? Array.from({ length: Math.ceil(dates.length / 7) }, (_, index) =>
          dates.slice(index * 7, index * 7 + 7),
        )
      : [];
  const asleepDays = report.sleep.filter(day => day.asleepSeconds > 0);
  return {
    period: report.window,
    calendarDays: dates.length,
    partialDates: report.days.filter(day => day.partial).map(day => day.date),
    quantities: report.quantities.map((series, index) => {
      const step =
        series.concept === 'step_count' ||
        series.concept === 'workout_duration';
      const recent = series.days.filter(day => recentDateSet.has(day.date));
      const previous = series.days.filter(day => previousDateSet.has(day.date));
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
          previousDates: [...previousDates],
          recentDates: [...recentDates],
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
    ...(report.doseHistory ? { doseHistory: report.doseHistory } : {}),
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
      ...(report.quantities.some(series => series.concept === 'heart_rate')
        ? [
            'heart_rate_workout_overlap_is_temporal_only_not_exercise_causation_or_abnormality',
            'workout_intervals_can_include_pauses_partial_overlap_does_not_attribute_the_whole_heart_rate_sample',
            'no_recorded_workout_overlap_is_not_resting_heart_rate_or_proof_of_inactivity_recovery_may_follow_workouts',
            'unknown_activity_includes_missing_intervals_no_available_workouts_or_samples_extending_beyond_period_no_permission_inference',
          ]
        : []),
      'medication_registration_and_current_confirmation_are_distinct_from_individual_dose_completion',
      ...(report.quantities.some(
        series =>
          series.concept === 'step_count' ||
          series.concept === 'workout_duration',
      )
        ? [
            'sensor_step_sample_sums_may_overlap_do_not_add_series_or_infer_complete_daily_totals',
            'workout_durations_are_source_samples_may_overlap_and_are_assigned_to_start_day_without_proration',
          ]
        : []),
    ],
  };
}
