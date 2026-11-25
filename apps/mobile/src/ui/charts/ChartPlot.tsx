import { useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { AppText as Text } from '../../layout/AppText';
import { t } from '../../i18n';
import { ChartPointSelection } from './ChartPointSelection';
import { chartAccessibilitySummary } from './chartAccessibilitySummary';
import { ChartBarTooltip } from './ChartBarTooltip';
import { ChartRenderer } from './ChartRenderer';
import { formatChartTick } from './format';
import { chartWindows } from './window';
import type { ChartAxis, ChartData, ChartKind } from './types';

type Props = {
  data: ChartData;
  width: number;
  height: number;
  title: string;
  testID?: string;
  selectedPointTestID?: string;
  kind: ChartKind;
  rangeAxis?: ChartAxis;
  lineAxis?: ChartAxis;
  /** Compact charts hide metadata by default; existing consumers retain their presentation. */
  compact?: boolean;
  /** Overview removes detail UI entirely while retaining an accessible chart description. */
  hideDetails?: boolean;
  /** Omit raw legend units; keep source in the selected mark when needed. */
  legendLabelsOnly?: boolean;
  /** Omit a redundant series legend without changing point selection or chart accessibility. */
  hideSeriesLegend?: boolean;
  /** Preserve the chart image and summary before the user requests details. */
  accessibleCollapsedPlot?: boolean;
  /** Opt-in selection without restoring the removed details disclosure. */
  barTooltip?: boolean;
};

function comparePositions(left: number | string, right: number | string) {
  if (typeof left === 'number' && typeof right === 'number')
    return left - right;
  return String(left).localeCompare(String(right));
}

/** Shares chart status, paging, unit-aware rendering, and one selected measurement across feature surfaces. */
export function ChartPlot({
  data,
  width,
  height,
  title,
  testID,
  selectedPointTestID,
  kind,
  rangeAxis = 'day',
  lineAxis = 'time',
  compact = false,
  hideDetails = false,
  legendLabelsOnly = false,
  hideSeriesLegend = false,
  accessibleCollapsedPlot = false,
  barTooltip = false,
}: Props) {
  const { fontScale } = useWindowDimensions();
  const axis =
    kind === 'range' ? rangeAxis : kind === 'line' ? lineAxis : 'day';
  const [pageIndex, setPageIndex] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const showDetails = !hideDetails && (!compact || detailsOpen);
  const accessiblePlot =
    hideDetails || (accessibleCollapsedPlot && !showDetails);
  const canShow =
    data.coverage.status !== 'permission' && data.coverage.status !== 'empty';
  const pages = canShow ? chartWindows(data, axis) : [];
  const page = Math.min(pageIndex, Math.max(0, pages.length - 1));
  const visible = pages[page];
  const measuredSeries =
    visible?.series.filter(series => series.points.length > 0) ?? [];
  const showLegend =
    !hideSeriesLegend &&
    (showDetails || (hideDetails && measuredSeries.length > 1)) &&
    (!legendLabelsOnly ||
      new Set(measuredSeries.map(series => series.label)).size > 1);
  const positions = visible
    ? [
        ...new Set(
          visible.series.flatMap(series =>
            series.points.map(point =>
              axis === 'time' ? Date.parse(point.x) : point.x,
            ),
          ),
        ),
      ].sort(comparePositions)
    : [];
  const formatPosition = (value: number | string) =>
    formatChartTick(
      typeof value === 'number' ? new Date(value).toISOString() : value,
      axis,
    );
  const changePage = (nextPage: number) => {
    setPageIndex(nextPage);
  };

  return (
    <View
      testID={testID}
      accessibilityState={{ busy: data.coverage.status === 'loading' }}
    >
      {showDetails ? <Text accessibilityRole="header">{title}</Text> : null}
      {showDetails || !['ready', 'partial'].includes(data.coverage.status) ? (
        <Text accessibilityState={{ busy: data.coverage.status === 'loading' }}>
          {t(`chart.state.${data.coverage.status}`)}
        </Text>
      ) : null}
      {showDetails ? <Text>{t('chart.coverage', data.coverage)}</Text> : null}
      {pages.length > 1 && positions.length > 0 && (
        <View>
          <Text testID={testID ? `${testID}-page` : undefined}>
            {t('chart.page', { page: page + 1, count: pages.length })}
          </Text>
          <Text>
            {t('chart.pageRange', {
              start: formatPosition(positions[0]!),
              end: formatPosition(positions[positions.length - 1]!),
            })}
          </Text>
          <Pressable
            accessibilityRole="button"
            testID={testID ? `${testID}-previous` : undefined}
            accessibilityState={{ disabled: page === 0 }}
            disabled={page === 0}
            onPress={() => changePage(page - 1)}
            style={styles.pageButton}
          >
            <Text>{t('chart.previous')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            testID={testID ? `${testID}-next` : undefined}
            accessibilityState={{ disabled: page === pages.length - 1 }}
            disabled={page === pages.length - 1}
            onPress={() => changePage(page + 1)}
            style={styles.pageButton}
          >
            <Text>{t('chart.next')}</Text>
          </Pressable>
        </View>
      )}
      {/* Multiple measured lines still need labels when detailed prose is hidden. */}
      {visible && showLegend && (
        <View style={styles.legend}>
          {measuredSeries.map(series => (
            <Text key={series.id}>
              {series.label}
              {kind === 'line' && data.series.length > 1
                ? ` (${t(series.style === 'primary' ? 'chart.solidLine' : 'chart.dashedLine')})`
                : ''}
              {!legendLabelsOnly && series.unit ? ` · ${series.unit}` : ''}
            </Text>
          ))}
        </View>
      )}
      {barTooltip &&
      axis === 'day' &&
      visible &&
      positions.length > 0 &&
      width > 0 ? (
        <ChartBarTooltip
          key={JSON.stringify([visible, width, height, fontScale])}
          data={visible}
          width={width}
          height={height}
          title={title}
          kind={kind}
          includeSelectedSource={legendLabelsOnly}
          testID={testID ? `${testID}-plot` : undefined}
        />
      ) : (
        <View
          accessible={accessiblePlot}
          accessibilityRole={accessiblePlot ? 'image' : undefined}
          accessibilityLabel={
            accessiblePlot
              ? chartAccessibilitySummary(visible, axis, title)
              : undefined
          }
          testID={
            accessiblePlot && selectedPointTestID
              ? selectedPointTestID
              : testID
                ? `${testID}-plot`
                : undefined
          }
        >
          {visible && positions.length > 0 && width > 0 ? (
            <ChartRenderer
              data={visible}
              width={width}
              height={height}
              kind={kind}
              rangeAxis={rangeAxis}
              lineAxis={lineAxis}
            />
          ) : (
            <View style={{ height }} />
          )}
        </View>
      )}
      {compact && !hideDetails ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(
            detailsOpen ? 'chart.hideDetails' : 'chart.details',
          )}
          accessibilityHint={t(`chart.state.${data.coverage.status}`)}
          accessibilityState={{ expanded: detailsOpen }}
          onPress={() => setDetailsOpen(value => !value)}
          style={styles.pageButton}
          testID={testID ? `${testID}-details` : undefined}
        >
          <Text>{t(detailsOpen ? 'chart.hideDetails' : 'chart.details')}</Text>
        </Pressable>
      ) : null}
      {showDetails ? (
        <ChartPointSelection
          data={visible}
          axis={axis}
          testID={
            selectedPointTestID ??
            (testID ? `${testID}-selected-point` : undefined)
          }
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pageButton: { minHeight: 44, justifyContent: 'center' },
});
