import { t } from '../../i18n';
import { formatChartPosition, formatChartValue } from './format';
import type { ChartData } from './types';

/** Keeps chart-only cards readable without introducing a hidden details action or mutating records. */
export function chartAccessibilitySummary(
  data: ChartData | undefined,
  axis: 'time' | 'day',
  title: string,
): string {
  if (!data) return title;
  return [
    title,
    t(`chart.state.${data.coverage.status}`),
    ...data.series.flatMap(series =>
      series.points.map(point =>
        [
          formatChartPosition(point.x, axis),
          series.label,
          point.value === null
            ? t('chart.missing')
            : formatChartValue(data.metric, point.value, series.unit),
          point.partial ? t('chart.partialValue') : '',
          t('chart.source', { source: point.source }),
        ]
          .filter(Boolean)
          .join('. '),
      ),
    ),
  ].join('. ');
}
