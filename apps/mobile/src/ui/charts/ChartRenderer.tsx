import {
  BarChart,
  ChartKitProvider,
  LineChart,
} from 'react-native-chart-kit/v2';
import { useColorScheme, useWindowDimensions, View } from 'react-native';
import { appColorPalettes } from '../../layout/appColors';
import {
  formatChartTick,
  formatChartTimeTick,
  formatChartValue,
  usesWholeBpm,
} from './format';
import { chartRows, lineSegments } from './model';
import type { ChartAxis, ChartData, ChartKind, ChartMetric } from './types';
import {
  ChartRangeRenderer,
  type ChartBucketSelect,
} from './ChartRangeRenderer';

type Props = {
  data: ChartData;
  width: number;
  height: number;
  kind: ChartKind;
  rangeAxis?: ChartAxis;
  lineAxis?: ChartAxis;
  onBarSelect?: ChartBucketSelect;
};

const token: Record<
  ChartMetric,
  'purple' | 'pink' | 'primaryText' | 'green' | 'danger'
> = {
  sleep: 'purple',
  heartRate: 'pink',
  bodyMass: 'primaryText',
  steps: 'green',
  workouts: 'green',
  bloodPressure: 'danger',
};

/** Keeps unlike units on independent native plot scales instead of implying an unrequested conversion. */
export function ChartRenderer({
  data,
  width,
  height,
  kind,
  rangeAxis = 'day',
  lineAxis = 'time',
  onBarSelect,
}: Props) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const { fontScale } = useWindowDimensions();
  const palette = appColorPalettes[scheme];
  const chartHeight = Math.ceil(height * Math.max(1, fontScale));
  const units = [
    ...new Set(
      data.series.filter(item => item.points.length > 0).map(item => item.unit),
    ),
  ];

  if (width <= 0) return <View style={{ height: chartHeight }} />;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {units.map((unit, index) => {
        const unitData: ChartData = {
          ...data,
          series: data.series.filter(item => item.unit === unit),
        };
        if (kind === 'range')
          return (
            <ChartRangeRenderer
              key={unit}
              series={unitData.series}
              axis={rangeAxis}
              wholeBpm={usesWholeBpm(data.metric, unit, data.presentation)}
              width={width}
              height={chartHeight}
              color={palette[token[data.metric]]}
              contrast={palette.background}
              labels={palette.text}
              guideColor={palette.border}
              fontSize={11 * fontScale}
              offsetY={index * chartHeight}
              onSelect={onBarSelect}
            />
          );
        const line =
          kind === 'line' ? lineSegments(unitData, lineAxis) : undefined;
        const rows =
          line?.rows ?? (kind === 'bar' ? chartRows(unitData, 'day') : []);
        if (rows.length === 0) return null;

        const baseSeries = unitData.series.map(item => ({
          yKey: item.id,
          label: item.label,
          color:
            item.style === 'primary'
              ? palette[token[data.metric]]
              : palette.primaryText,
          ...(item.style === 'secondary' ? { strokeDasharray: [5, 3] } : {}),
        }));
        const series = line
          ? line.segments.map(segment => ({
              ...baseSeries[
                unitData.series.findIndex(item => item.id === segment.seriesId)
              ]!,
              yKey: segment.id,
              ...(segment.bridge
                ? { strokeDasharray: [4, 4], strokeOpacity: 0.6, dot: false }
                : {}),
            }))
          : baseSeries;
        const xLabel = (value: string | number | Date) =>
          formatChartTick(
            typeof value === 'number'
              ? new Date(value).toISOString().slice(0, 10)
              : String(value),
            kind === 'line' ? lineAxis : 'day',
          );
        const timeTick = (value: string | number | Date, pointIndex: number) =>
          pointIndex === 0 || pointIndex === rows.length - 1
            ? formatChartTimeTick(
                value instanceof Date ? value.getTime() : Number(value),
              )
            : '';
        const formatValue = (value: number) =>
          formatChartValue(data.metric, value, unit);

        return (
          <ChartKitProvider
            key={`${unit}-${index}`}
            mode={scheme}
            theme={{
              grid: palette.border,
              text: palette.text,
              mutedText: palette.text,
              typography: { axisLabelSize: 11 * fontScale },
            }}
          >
            {kind === 'line' ? (
              <LineChart
                data={rows}
                xKey="x"
                series={series}
                width={width}
                height={chartHeight}
                theme={scheme}
                curve="linear"
                connectNulls
                legend={false}
                decimation={false}
                showDots
                showHorizontalGridLines
                showVerticalGridLines={false}
                tooltip={false}
                interaction={
                  onBarSelect
                    ? {
                        mode: 'tap',
                        onSelect: event => {
                          const segment = line?.segments.find(
                            candidate =>
                              !candidate.bridge &&
                              event.series.some(
                                item =>
                                  item.key === candidate.id &&
                                  item.value != null,
                              ),
                          );
                          const x = event.raw?.x;
                          onBarSelect(
                            segment && typeof x === 'number'
                              ? {
                                  x: new Date(x).toISOString().slice(0, 10),
                                  seriesId: segment.seriesId,
                                  position: {
                                    x: event.position.x,
                                    y: event.position.y + index * chartHeight,
                                  },
                                }
                              : null,
                          );
                        },
                        onDeselect: () => onBarSelect(null),
                      }
                    : 'none'
                }
                formatXLabel={lineAxis === 'day' ? xLabel : timeTick}
                formatYLabel={formatValue}
              />
            ) : (
              <BarChart
                data={rows}
                xKey="x"
                series={series}
                width={width}
                height={chartHeight}
                theme={scheme}
                interaction={
                  onBarSelect
                    ? {
                        mode: 'tap',
                        onSelect: event =>
                          onBarSelect({
                            x: String(event.x),
                            seriesId: event.seriesKey,
                            // Each unit owns a vertically stacked plot.
                            position: {
                              x: event.position.x,
                              y: event.position.y + index * chartHeight,
                            },
                          }),
                        onDeselect: () => onBarSelect(null),
                      }
                    : 'none'
                }
                tooltip={false}
                selectionAnimation={false}
                formatXLabel={xLabel}
                formatYLabel={formatValue}
              />
            )}
          </ChartKitProvider>
        );
      })}
    </View>
  );
}
