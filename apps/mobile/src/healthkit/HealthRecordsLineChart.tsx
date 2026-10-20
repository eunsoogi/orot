import { useMemo, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import type { HealthObservation } from '@orot/domain';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import type { HealthRecordCategory } from './healthRecordsLibraryModel';
import { healthRecordCategoryTitle } from './healthRecordsLibraryModel';
import {
  buildHealthChartSeries,
  healthChartDateLabel,
  healthChartMaximum,
  healthChartSummary,
} from './healthRecordsChartModel';
import { healthRecordsChartStyles as styles } from './HealthRecordsLineChart.styles';

interface HealthRecordsLineChartProps {
  readonly category: HealthRecordCategory;
  readonly observations: readonly HealthObservation[];
}

/** Connects saved points without inventing dates; VoiceOver gets the full summary without a visible data paragraph. */
export function HealthRecordsLineChart({
  category,
  observations,
}: HealthRecordsLineChartProps) {
  const { fontScale } = useWindowDimensions();
  const dateLabelWidth = 68 * fontScale;
  const [containerWidth, setContainerWidth] = useState(0);
  const series = useMemo(
    () => buildHealthChartSeries(category, observations),
    [category, observations],
  );
  const title = healthRecordCategoryTitle(category);
  const summary = healthChartSummary(series, title);
  const maximum = healthChartMaximum(series, category);
  const axisWidth = 38;
  const plotWidth = Math.max(0, containerWidth - axisWidth);
  const plotHeight = 144;
  const times = [
    ...new Set(
      series.flatMap(item => item.points.map(point => point.effectiveAt)),
    ),
  ].sort((left, right) => left.localeCompare(right));
  const tickTimes =
    times.length <= 3
      ? times
      : [
          times[0]!,
          times[Math.floor((times.length - 1) / 2)]!,
          times[times.length - 1]!,
        ];
  const xFor = (timestamp: string) => {
    const time = new Date(timestamp).getTime();
    const first = new Date(times[0] ?? timestamp).getTime();
    const last = new Date(times[times.length - 1] ?? timestamp).getTime();
    return last === first
      ? plotWidth / 2
      : ((time - first) / (last - first)) * plotWidth;
  };
  const yFor = (amount: number) => plotHeight - (amount / maximum) * plotHeight;

  return (
    <View
      accessible
      accessibilityLabel={summary}
      accessibilityRole="image"
      style={styles.container}
      testID={'health-record-chart-' + category}
    >
      <Text style={styles.unitLabel}>{series[0]?.points[0]?.unit ?? ''}</Text>
      {category === 'blood_pressure' ? (
        <View style={styles.legend}>
          <LegendItem
            color={appColors.dangerAction}
            label={t('healthkit.bloodPressure.component.systolic')}
          />
          <LegendItem
            color={appColors.primaryAction}
            label={t('healthkit.bloodPressure.component.diastolic')}
          />
        </View>
      ) : null}
      <View
        onLayout={event => setContainerWidth(event.nativeEvent.layout.width)}
        style={styles.chartRow}
        testID="health-record-chart-plot-row"
      >
        <View style={[styles.axis, { height: plotHeight }]}>
          {[1, 0.8, 0.6, 0.4, 0.2, 0].map(fraction => (
            <Text key={fraction} style={styles.axisLabel}>
              {Math.round(maximum * fraction)}
            </Text>
          ))}
        </View>
        <View style={[styles.plot, { height: plotHeight }]}>
          {[0, 0.2, 0.4, 0.6, 0.8, 1].map(fraction => (
            <View
              key={fraction}
              style={[styles.gridLine, { top: plotHeight * fraction }]}
            />
          ))}
          {series.flatMap(item =>
            item.points.slice(1).map((point, index) => {
              const previous = item.points[index];
              if (!previous) return null;
              const x1 = xFor(previous.effectiveAt);
              const x2 = xFor(point.effectiveAt);
              const y1 = yFor(previous.amount);
              const y2 = yFor(point.amount);
              const length = Math.hypot(x2 - x1, y2 - y1);
              const angle = Math.atan2(y2 - y1, x2 - x1);
              return (
                <View
                  key={item.key + '-line-' + point.id}
                  style={[
                    styles.lineSegment,
                    {
                      backgroundColor: item.color,
                      left: (x1 + x2 - length) / 2,
                      top: (y1 + y2) / 2,
                      transform: [{ rotate: angle + 'rad' }],
                      width: length,
                    },
                  ]}
                />
              );
            }),
          )}
          {series.flatMap(item =>
            // A singleton has no line segment; denser series use lines only.
            item.points
              .filter(() => item.points.length === 1)
              .map(point => (
                <View
                  key={point.id}
                  style={[
                    styles.point,
                    {
                      backgroundColor: point.color,
                      left: xFor(point.effectiveAt) - 6,
                      top: yFor(point.amount) - 6,
                    },
                  ]}
                />
              )),
          )}
          {series.flatMap(item =>
            item.points
              .filter(
                point =>
                  item.points.length <= 5 ||
                  tickTimes.includes(point.effectiveAt),
              )
              .map(point => (
                <Text
                  key={item.key + '-label-' + point.id}
                  style={[
                    styles.pointLabel,
                    {
                      color: point.color,
                      left: xFor(point.effectiveAt) - 14,
                      top: yFor(point.amount) - 28,
                    },
                  ]}
                >
                  {point.amount}
                </Text>
              )),
          )}
        </View>
      </View>
      <View
        style={[
          styles.dateAxis,
          { marginLeft: axisWidth, minHeight: 36 * fontScale },
        ]}
      >
        {tickTimes.map((timestamp, index) => {
          const x = xFor(timestamp);
          const first = index === 0;
          const last = index === tickTimes.length - 1;
          // Hide colliding interior labels, never move a date away from its measured point.
          if (
            !first &&
            !last &&
            (x < dateLabelWidth * 1.5 || plotWidth - x < dateLabelWidth * 1.5)
          )
            return null;
          const offset =
            first && !last
              ? 0
              : last && !first
                ? -dateLabelWidth
                : -dateLabelWidth / 2;
          return (
            <View
              key={timestamp}
              testID={'health-chart-date-' + timestamp}
              style={{ position: 'absolute', left: x }}
            >
              <Text
                style={[
                  styles.dateLabel,
                  {
                    left: offset,
                    width: dateLabelWidth,
                    textAlign:
                      first && !last
                        ? 'left'
                        : last && !first
                          ? 'right'
                          : 'center',
                  },
                ]}
              >
                {healthChartDateLabel(timestamp)}
              </Text>
            </View>
          );
        })}
      </View>
      <Text style={styles.measuredOnly}>{t('healthRecords.measuredOnly')}</Text>
    </View>
  );
}

function LegendItem({
  color,
  label,
}: {
  readonly color: string;
  readonly label: string;
}) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}
