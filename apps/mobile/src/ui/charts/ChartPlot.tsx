import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  BarChart,
  ChartKitProvider,
  LineChart,
} from 'react-native-chart-kit/v2';
import { AppText as Text } from '../../layout/AppText';
import { appColorPalettes } from '../../layout/appColors';
import { t } from '../../i18n';
import {
  formatChartPosition,
  formatChartTick,
  formatChartTimeTick,
  formatChartValue,
} from './format';
import { chartRows, lineSegments } from './model';
import { chartWindows } from './window';
import type { ChartData, ChartMetric } from './types';

type Props = {
  data: ChartData;
  width: number;
  height: number;
  title: string;
  testID?: string;
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
  testID,
  kind,
}: Props & { kind: 'line' | 'bar' }) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const { fontScale } = useWindowDimensions();
  const palette = appColorPalettes[scheme];
  const [pageIndex, setPageIndex] = useState(0);
  const canShow =
    data.coverage.status !== 'permission' && data.coverage.status !== 'empty';
  const axis = kind === 'line' ? 'time' : 'day';
  const pages = canShow ? chartWindows(data, axis) : [];
  const page = Math.min(pageIndex, Math.max(0, pages.length - 1));
  const visible = pages[page];
  const line = visible && kind === 'line' ? lineSegments(visible) : undefined;
  const rows =
    line?.rows ?? (visible && kind === 'bar' ? chartRows(visible, 'day') : []);
  const baseSeries = data.series.map(item => ({
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
          data.series.findIndex(item => item.id === segment.seriesId)
        ]!,
        yKey: segment.id,
      }))
    : baseSeries;
  const formatPosition = (value: string) => formatChartPosition(value, axis);
  const formatValue = (value: number, unit: string) =>
    formatChartValue(data.metric, value, unit);
  const xLabel = (value: string | number | Date) =>
    formatChartTick(
      typeof value === 'number' ? new Date(value).toISOString() : String(value),
      axis,
    );
  const timeTick = (value: string | number | Date, index: number) =>
    index === 0 || index === rows.length - 1
      ? formatChartTimeTick(
          value instanceof Date ? value.getTime() : Number(value),
        )
      : '';
  const unit = data.series[0]?.unit ?? '';
  return (
    <View
      testID={testID}
      accessibilityState={{ busy: data.coverage.status === 'loading' }}
    >
      <Text accessibilityRole="header">{title}</Text>
      <Text accessibilityState={{ busy: data.coverage.status === 'loading' }}>
        {t(`chart.state.${data.coverage.status}`)}
      </Text>
      <Text>{t('chart.coverage', data.coverage)}</Text>
      {pages.length > 1 && rows.length > 0 && (
        <View>
          <Text testID={testID ? `${testID}-page` : undefined}>
            {t('chart.page', { page: page + 1, count: pages.length })}
          </Text>
          <Text>
            {t('chart.pageRange', {
              start: xLabel(rows[0]!.x),
              end: xLabel(rows[rows.length - 1]!.x),
            })}
          </Text>
          <Pressable
            accessibilityRole="button"
            testID={testID ? `${testID}-previous` : undefined}
            accessibilityState={{ disabled: page === 0 }}
            disabled={page === 0}
            onPress={() => setPageIndex(page - 1)}
            style={styles.pageButton}
          >
            <Text>{t('chart.previous')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            testID={testID ? `${testID}-next` : undefined}
            accessibilityState={{ disabled: page === pages.length - 1 }}
            disabled={page === pages.length - 1}
            onPress={() => setPageIndex(page + 1)}
            style={styles.pageButton}
          >
            <Text>{t('chart.next')}</Text>
          </Pressable>
        </View>
      )}
      {fontScale > 1.6 && rows.length > 0 ? (
        <Text>{t('chart.largeText')}</Text>
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
                formatXLabel={timeTick}
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
      {visible &&
        visible.series.map(item => (
          <View key={item.id}>
            <Text>
              {item.label}
              {kind === 'line' && data.series.length > 1
                ? ` (${t(item.style === 'primary' ? 'chart.solidLine' : 'chart.dashedLine')})`
                : ''}
            </Text>
            {item.points.map((point, index) => (
              <Text key={`${point.x}-${index}`}>
                {formatPosition(point.x)}:{' '}
                {point.value === null
                  ? t('chart.missing')
                  : formatValue(point.value, item.unit)}
                {point.partial ? ` · ${t('chart.partialValue')}` : ''}
                {' · '}
                {t('chart.source', { source: point.source })}
              </Text>
            ))}
          </View>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  pageButton: { minHeight: 44, justifyContent: 'center' },
});
