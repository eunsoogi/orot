import {
  factObject,
  finiteFact,
  statisticSourceTime,
  type ComputedFact,
  type StatisticChoice,
} from './computedStatisticChoice';

const labels: Readonly<Record<string, string>> = {
  blood_pressure_systolic: '수축기 혈압',
  'blood pressure systolic': '수축기 혈압',
  blood_pressure_diastolic: '이완기 혈압',
  'blood pressure diastolic': '이완기 혈압',
  heart_rate: '심박수',
  body_mass: '체중',
  weight: '체중',
  step_count: '걸음 수',
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
    const unit = step ? '걸음' : series.unit;
    const amount = (value: number) => `${value} ${unit}`;
    const mean = step
      ? series.meanRecordedDailySampleSum
      : series.meanOfRecordedDailyMeans;
    const views: Record<string, string> = {};
    if (finiteFact(mean))
      views.mean = `${step ? '기록일별 센서 샘플 합 평균' : '기록일 평균'} ${amount(mean)}`;
    if (factObject(series.latest) && finiteFact(series.latest.amount)) {
      const time = statisticSourceTime(series.latest.occurredAt, source);
      views.latest = `최근 측정 ${amount(series.latest.amount)}${time ? ` · ${time}` : ''}`;
    }
    if (finiteFact(series.minimumSample) && finiteFact(series.maximumSample))
      views.range = `개별 측정 범위 ${amount(series.minimumSample)} ~ ${amount(series.maximumSample)}`;
    const comparison = series.comparison;
    if (
      factObject(comparison) &&
      finiteFact(comparison.previousMean) &&
      finiteFact(comparison.recentMean) &&
      finiteFact(comparison.difference)
    )
      views.comparison = `앞선 7일 평균 ${amount(comparison.previousMean)} → 최근 7일 평균 ${amount(comparison.recentMean)} · 차이 ${amount(comparison.difference)}${finiteFact(comparison.previousRecordedDays) && finiteFact(comparison.recentRecordedDays) ? ` · 각 기록 ${comparison.previousRecordedDays}일 / ${comparison.recentRecordedDays}일` : ''}`;
    if (!Object.keys(views).length) return [];
    const coverage = [
      finiteFact(series.recordedDays)
        ? `기록 ${series.recordedDays}일${finiteFact(source.calendarDays) ? ` / ${source.calendarDays}일` : ''}`
        : '',
      finiteFact(series.sampleCount) ? `측정 ${series.sampleCount}건` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    const sensor = finiteFact(series.sensorSeries)
      ? series.sensorSeries
      : index + 1;
    const title = `${labels[series.concept] ?? series.concept} · 측정 출처 ${sensor}`;
    const limitation = step
      ? ' 출처별 샘플은 중복될 수 있어 합산하거나 전체 일일 걸음수로 해석할 수 없어요.'
      : '';
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
