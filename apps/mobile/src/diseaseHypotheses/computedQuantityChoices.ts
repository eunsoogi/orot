import { t } from '../i18n';
import {
  factObject,
  finiteFact,
  statisticSourceTime,
  type ComputedFact,
  type StatisticChoice,
} from './computedStatisticChoice';

const labels: Readonly<Record<string, string>> = {
  blood_pressure_systolic: t('computedQuantity.systolic'),
  'blood pressure systolic': t('computedQuantity.systolic'),
  blood_pressure_diastolic: t('computedQuantity.diastolic'),
  'blood pressure diastolic': t('computedQuantity.diastolic'),
  heart_rate: t('computedQuantity.heartRate'),
  body_mass: t('computedQuantity.weight'),
  weight: t('computedQuantity.weight'),
  step_count: t('computedQuantity.steps'),
};

/** Every supplied measured series is required independently, including overlapping sensors.
 * A selected comparison never converts sample sums into a merged daily activity total. */
export function computedQuantityChoices(
  source: ComputedFact,
): StatisticChoice[] {
  if (!Array.isArray(source.quantities)) return [];
  return source.quantities.flatMap((series, index) => {
    if (
      !factObject(series) ||
      typeof series.concept !== 'string' ||
      typeof series.unit !== 'string'
    )
      return [];
    const step = series.concept === 'step_count';
    const unit = step ? t('computedQuantity.stepUnit') : series.unit;
    const amount = (value: number) => `${value} ${unit}`;
    const mean = step
      ? series.meanRecordedDailySampleSum
      : series.meanOfRecordedDailyMeans;
    const views: Record<string, string> = {};
    if (finiteFact(mean))
      views.mean = `${step ? t('computedQuantity.sampleMean') : t('computedQuantity.recordedMean')} ${amount(mean)}`;
    if (factObject(series.latest) && finiteFact(series.latest.amount)) {
      const time = statisticSourceTime(series.latest.occurredAt, source);
      views.latest = t('computedQuantity.latest', {
        amount: amount(series.latest.amount),
        time: time ? ` · ${time}` : '',
      });
    }
    if (finiteFact(series.minimumSample) && finiteFact(series.maximumSample))
      views.range = t('computedQuantity.range', {
        minimum: amount(series.minimumSample),
        maximum: amount(series.maximumSample),
      });
    const comparison = series.comparison;
    if (
      factObject(comparison) &&
      finiteFact(comparison.previousMean) &&
      finiteFact(comparison.recentMean) &&
      finiteFact(comparison.difference)
    )
      views.comparison = t('computedQuantity.comparison', {
        previous: amount(comparison.previousMean),
        recent: amount(comparison.recentMean),
        difference: amount(comparison.difference),
        coverage:
          finiteFact(comparison.previousRecordedDays) &&
          finiteFact(comparison.recentRecordedDays)
            ? t('computedQuantity.comparisonCoverage', {
                previous: comparison.previousRecordedDays,
                recent: comparison.recentRecordedDays,
              })
            : '',
      });
    if (!Object.keys(views).length) return [];
    const coverage = [
      finiteFact(series.recordedDays)
        ? t('computedQuantity.coverage', {
            days: series.recordedDays,
            calendar: finiteFact(source.calendarDays)
              ? t('computedQuantity.calendarDays', {
                  days: source.calendarDays,
                })
              : '',
          })
        : '',
      finiteFact(series.sampleCount)
        ? t('computedQuantity.samples', { count: series.sampleCount })
        : '',
    ]
      .filter(Boolean)
      .join(' · ');
    const sensor = finiteFact(series.sensorSeries)
      ? series.sensorSeries
      : index + 1;
    const title = t('computedQuantity.title', {
      concept: labels[series.concept] ?? series.concept,
      sensor,
    });
    const limitation = step ? t('computedQuantity.overlap') : '';
    return [
      {
        key: `q${index}`,
        description: `Select the most useful available statistic for quantities[${index}] (${series.concept}, sensor ${sensor}). Values, units and coverage are bound from this source locally.`,
        texts: Object.fromEntries(
          Object.entries(views).map(([key, text]) => [
            key,
            `${title}: ${text}${coverage ? ` · ${coverage}` : ''}.${limitation}`,
          ]),
        ),
      },
    ];
  });
}
