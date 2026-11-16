import { labels, comparisonText } from './healthContextDisplay';
import { t } from '../../i18n';
import type { projectHealthContext } from '../../healthEvidence/healthContext/projection';
import type { EvidenceSourceDetailSection } from './evidenceSourcePresentation';
import type { HealthContextScope } from '../../healthEvidence/healthContext/scope';

/** Show the full sensor range alongside descriptive activity strata without a clinical classification. */
export function presentHealthQuantities(
  projected: ReturnType<typeof projectHealthContext>,
  scope: HealthContextScope,
): EvidenceSourceDetailSection[] {
  return projected.quantities.map((series, index) => {
    const step =
      series.concept === 'step_count' || series.concept === 'workout_duration';
    const mean = step
      ? series.meanRecordedDailySampleSum
      : series.meanOfRecordedDailyMeans;
    return {
      title: t('healthContextCopy.sourceTitle', {
        label: labels[series.concept] ?? series.concept,
        index: index + 1,
      }),
      rows: [
        {
          label: t('healthContextCopy.recordedDays'),
          value: t('healthContextCopy.daysRatio', {
            recorded: series.recordedDays,
            total: projected.calendarDays,
          }),
        },
        {
          label: t('healthContextCopy.sampleCount'),
          value: t('healthContextCopy.countValue', {
            count: series.sampleCount,
          }),
        },
        {
          label: step
            ? t('healthContextCopy.meanDailySampleSum')
            : t('healthContextCopy.meanDailyMeans'),
          value: `${mean} ${series.unit}`,
        },
        {
          label: t('healthContextCopy.sampleRange'),
          value: `${series.minimumSample} ~ ${series.maximumSample} ${series.unit}`,
        },
        ...(series.activityContext?.map(group => ({
          label: t(
            group.context === 'workout_overlap'
              ? 'healthContextCopy.workoutOverlap'
              : group.context === 'no_recorded_workout_overlap'
                ? 'healthContextCopy.noWorkoutOverlap'
                : 'healthContextCopy.activityUnknown',
          ),
          value: `${group.minimum} ~ ${group.maximum} ${series.unit} · ${t('healthContextCopy.countValue', { count: group.samples })}`,
        })) ?? []),
        ...(series.activityContext
          ? [
              {
                label: t('healthContextCopy.aggregationBasis'),
                value: t('healthContextCopy.heartActivityNotice'),
              },
            ]
          : []),
        ...(series.latest
          ? [
              {
                label: t('healthContextCopy.latestMeasurement'),
                value: `${series.latest.amount} ${series.unit} · ${new Date(series.latest.occurredAt).toLocaleString('ko-KR', { timeZone: scope.window.timeZone })}`,
              },
            ]
          : []),
        ...(series.comparison.difference !== null
          ? [
              {
                label: t('healthContextCopy.comparisonWeek'),
                value: comparisonText(series),
              },
            ]
          : []),
        ...(step
          ? [
              {
                label: t('healthContextCopy.aggregationBasis'),
                value: t('healthContextCopy.sampleSumNotice'),
              },
            ]
          : []),
      ],
    };
  });
}
