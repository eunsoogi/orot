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
} from './format';
import { chartRows, lineSegments } from './model';
import type { ChartData, ChartMetric } from './types';

type Props = {
  data: ChartData;
  width: number;
  height: number;
  kind: 'line' | 'bar';
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
export function ChartRenderer({ data, width, height, kind }: Props) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const { fontScale } = useWindowDimensions();
  const palette = appColorPalettes[scheme];
  const chartHeight = Math.ceil(height * Math.max(1, fontScale));
  const units = [...new Set(data.series.map(item => item.unit))];

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
        const line = kind === 'line' ? lineSegments(unitData) : undefined;
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
            }))
          : baseSeries;
        const xLabel = (value: string | number | Date) =>
          formatChartTick(
            typeof value === 'number'
              ? new Date(value).toISOString()
              : String(value),
            kind === 'line' ? 'time' : 'day',
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
            theme={{ typography: { axisLabelSize: 11 * fontScale } }}
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
                interaction="none"
                formatXLabel={timeTick}
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
                interaction="none"
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
