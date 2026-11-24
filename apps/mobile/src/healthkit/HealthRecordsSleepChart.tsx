import { useMemo, useState } from 'react';
import { View } from 'react-native';
import type { HealthObservation } from '@orot/domain';
import { t } from '../i18n';
import { ChartPlot, type ChartData, type ChartPoint } from '../ui/charts';
import { healthRecordPeriodTitle } from './healthRecordsLibraryModel';
import { provenanceLabel } from './healthRecordsDetailPresentation';
import { sleepAnalysisTypeIdentifier } from './sleep/types';

const asleepStages = new Set([
  '1',
  '3',
  '4',
  '5',
  'asleepUnspecified',
  'asleepCore',
  'asleepDeep',
  'asleepREM',
]);

type Interval = { start: number; end: number; source: string };

function localDay(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

/** Uses the same elapsed minutes on 23/25-hour days and unions overlapping saved samples.
 * The caller has already bounded start timestamps to the loaded month's records.
 */
export function sleepPreviewPoints(
  records: readonly HealthObservation[],
  now: Date,
  partial: boolean,
): readonly ChartPoint[] {
  const days = new Map<string, Interval[]>();
  for (const record of records) {
    if (
      record.concept !== sleepAnalysisTypeIdentifier ||
      record.value.kind !== 'text' ||
      !asleepStages.has(record.value.text) ||
      !record.endedAt
    )
      continue;
    let start = Date.parse(record.effectiveAt);
    // Dates beyond the visible window cannot create future plot values.
    const finish = Math.min(Date.parse(record.endedAt), now.getTime());
    if (!Number.isFinite(start) || !Number.isFinite(finish) || start >= finish)
      continue;
    while (start < finish) {
      const day = new Date(start);
      const next = new Date(start);
      next.setHours(24, 0, 0, 0);
      const end = Math.min(next.getTime(), finish);
      const key = localDay(day);
      const segments = days.get(key) ?? [];
      segments.push({ start, end, source: provenanceLabel(record) });
      days.set(key, segments);
      start = end;
    }
  }
  return [...days]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([x, segments]) => {
      let end = -Infinity;
      let duration = 0;
      for (const segment of segments.sort((a, b) => a.start - b.start)) {
        duration += Math.max(0, segment.end - Math.max(end, segment.start));
        end = Math.max(end, segment.end);
      }
      return {
        x,
        value: duration / 60000,
        source: [...new Set(segments.map(item => item.source))].join(', '),
        partial,
      };
    });
}

export function HealthRecordsSleepChart({
  observations,
  hasMore,
  loadState,
  now,
}: {
  readonly observations: readonly HealthObservation[];
  readonly hasMore: boolean;
  readonly loadState: 'loading' | 'ready' | 'failed';
  readonly now: Date;
}) {
  const [width, setWidth] = useState(0);
  const points = useMemo(
    () => sleepPreviewPoints(observations, now, hasMore),
    [observations, now, hasMore],
  );
  const status =
    loadState === 'loading'
      ? 'loading'
      : loadState === 'failed'
        ? points.length
          ? 'stale'
          : 'error'
        : hasMore
          ? 'partial'
          : points.length
            ? 'ready'
            : 'empty';
  const title = t('healthRecords.category.sleep');
  const data: ChartData = {
    metric: 'sleep',
    coverage: {
      requested: healthRecordPeriodTitle('month'),
      displayed: points.length
        ? points[0]!.x + ' – ' + points[points.length - 1]!.x
        : t(`chart.state.${status}`),
      status,
    },
    series: [
      {
        id: 'sleep-minutes',
        label: title,
        unit: 'min',
        style: 'primary',
        points,
      },
    ],
  };
  return (
    <View onLayout={event => setWidth(event.nativeEvent.layout.width)}>
      <ChartPlot
        data={data}
        compact
        hideDetails
        barTooltip
        width={width}
        height={200}
        title={title}
        kind="line"
        lineAxis="day"
        testID="health-record-chart-values-sleep"
        selectedPointTestID="health-record-chart-sleep"
      />
    </View>
  );
}
