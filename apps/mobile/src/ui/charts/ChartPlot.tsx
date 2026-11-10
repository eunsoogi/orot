import { useColorScheme, useWindowDimensions, View } from 'react-native';
import {
  BarChart,
  ChartKitProvider,
  LineChart,
} from 'react-native-chart-kit/v2';
import { AppText as Text } from '../../layout/AppText';
import { appColorPalettes } from '../../layout/appColors';
import { chartRows, lineSegments } from './model';
import type { ChartData, ChartMetric } from './types';

type Props = {
  data: ChartData;
  width: number;
  height: number;
  title: string;
  stateLabel: string;
  largeTextLabel: string;
  formatPosition: (position: string) => string;
  formatValue: (value: number, unit: string) => string;
};

const token: Record<
  ChartMetric,
  'purple' | 'pink' | 'primaryText' | 'green' | 'danger'
> = {
  sleep: 'purple',
  heartRate: 'pink',
  bodyMass: 'primaryText',
  steps: 'green',
  bloodPressure: 'danger',
};

/** The visible value list remains accessible without requiring a chart gesture. */
export function ChartPlot({
  data,
  width,
  height,
  title,
  stateLabel,
  largeTextLabel,
  formatPosition,
  formatValue,
  kind,
}: Props & { kind: 'line' | 'bar' }) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const { fontScale } = useWindowDimensions();
  const palette = appColorPalettes[scheme];
  const canShow =
    data.coverage.status !== 'permission' && data.coverage.status !== 'empty';
  const line = canShow && kind === 'line' ? lineSegments(data) : undefined;
  const rows =
    line?.rows ?? (canShow && kind === 'bar' ? chartRows(data, 'day') : []);
  const baseSeries = data.series.map((item, index) => ({
    yKey: item.id,
    label: item.label,
    color: index === 0 ? palette[token[data.metric]] : palette.primaryText,
    ...(index === 1 ? { strokeDasharray: [5, 3] } : {}),
  }));
  const series = line
    ? line.segments.map(segment => ({
        ...baseSeries[
          data.series.findIndex(item => item.id === segment.seriesId)
        ]!,
        yKey: segment.id,
      }))
    : baseSeries;
  const xLabel = (value: string | number | Date) =>
    formatPosition(
      typeof value === 'number' ? new Date(value).toISOString() : String(value),
    );
  const unit = data.series[0]?.unit ?? '';
  return (
    <View accessibilityState={{ busy: data.coverage.status === 'loading' }}>
      <Text accessibilityRole="header">{title}</Text>
      <Text>{stateLabel}</Text>
      {fontScale > 1.6 && rows.length > 0 ? (
        <Text>{largeTextLabel}</Text>
      ) : rows.length > 0 && width > 0 ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <ChartKitProvider
            mode={scheme}
            theme={{ typography: { axisLabelSize: 11 * fontScale } }}
          >
            {kind === 'line' ? (
              <LineChart
                data={rows}
                xKey="x"
                series={series}
                width={width}
                height={height}
                theme={scheme}
                curve="linear"
                connectNulls
                legend={false}
                decimation={false}
                showDots
                interaction="none"
                formatXLabel={xLabel}
                formatYLabel={value => formatValue(value, unit)}
              />
            ) : (
              <BarChart
                data={rows}
                xKey="x"
                series={series}
                width={width}
                height={height}
                theme={scheme}
                interaction="none"
                selectionAnimation={false}
                formatXLabel={xLabel}
                formatYLabel={value => formatValue(value, unit)}
              />
            )}
          </ChartKitProvider>
        </View>
      ) : (
        <View style={{ height }} />
      )}
      {canShow &&
        data.series.map(item => (
          <View key={item.id}>
            <Text>{item.label}</Text>
            {item.points.map((point, index) => (
              <Text key={`${point.x}-${index}`}>
                {formatPosition(point.x)}:{' '}
                {point.value === null
                  ? '—'
                  : formatValue(point.value, item.unit)}
                {point.partial ? ' *' : ''}
              </Text>
            ))}
          </View>
        ))}
    </View>
  );
}
