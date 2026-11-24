import Svg, { Circle, G, Line, Rect, Text as SvgText } from 'react-native-svg';
import { groupedRangeTicks } from './groupedRangeTicks';
import { chartRangeGeometry } from './chartRangeGeometry';
import {
  formatChartTick,
  formatChartTimeTick,
  formatRangeAxisValue,
} from './format';
import type { ChartAxis, ChartSeries } from './types';

export type ChartBucketSelect = (
  value: {
    x: string;
    seriesId: string;
    position: { x: number; y: number };
  } | null,
) => void;

/** Floating range glyphs have no zero baseline and no line connecting unrelated means. */
export function ChartRangeRenderer({
  series,
  axis,
  width,
  height,
  color,
  contrast,
  labels,
  guideColor,
  fontSize,
  offsetY,
  onSelect,
  wholeBpm = false,
}: {
  series: readonly ChartSeries[];
  axis: ChartAxis;
  width: number;
  height: number;
  color: string;
  contrast: string;
  labels: string;
  guideColor: string;
  fontSize: number;
  offsetY: number;
  onSelect?: ChartBucketSelect;
  wholeBpm?: boolean;
}) {
  // Keep scale labels away from range strokes; compact widths still expose exact values to AX.
  const axisLabelWidth = width >= 10 * fontSize ? 3.8 * fontSize : 0;
  const plot = chartRangeGeometry(series, width, height, axis, axisLabelWidth);
  if (!plot) return null;
  const groupedTicks =
    axis === 'day'
      ? groupedRangeTicks(
          series,
          width - axisLabelWidth,
          fontSize,
          plot.first,
          plot.last,
        )
      : undefined;
  return (
    <Svg width={width} height={height} testID="chart-range-plot">
      {plot.valueTicks.map(tick => (
        <Line
          key={tick.value}
          testID="chart-range-horizontal-guide"
          x1={0}
          x2={width - axisLabelWidth}
          y1={tick.y}
          y2={tick.y}
          stroke={guideColor}
          strokeWidth={1}
          pointerEvents="none"
        />
      ))}
      {plot.marks.map((mark, i) => (
        <G
          key={`${mark.series.id}-${mark.sourceX}-${i}`}
          testID="chart-range-bucket"
          onPress={
            onSelect
              ? () =>
                  onSelect({
                    x: mark.sourceX,
                    seriesId: mark.series.id,
                    position: { x: mark.x, y: mark.high + offsetY },
                  })
              : undefined
          }
        >
          {onSelect ? (
            <Rect
              x={Math.max(0, mark.x - 10)}
              y={Math.max(0, mark.high - 12)}
              width={20}
              height={Math.min(height, Math.max(32, mark.low - mark.high + 18))}
              fill="transparent"
            />
          ) : null}
          {mark.high === mark.low && wholeBpm ? (
            <Line
              testID="chart-range-flat"
              x1={mark.x - 3}
              x2={mark.x + 3}
              y1={mark.mean}
              y2={mark.mean}
              stroke={color}
              strokeWidth={Math.min(mark.stroke, 6)}
              strokeLinecap="round"
            />
          ) : mark.high === mark.low ? (
            <Circle
              testID="chart-range-single"
              cx={mark.x}
              cy={mark.mean}
              r={mark.stroke / 2}
              fill={color}
            />
          ) : (
            <>
              <Line
                testID="chart-range-span"
                x1={mark.x}
                x2={mark.x}
                y1={mark.high}
                y2={mark.low}
                stroke={color}
                strokeWidth={mark.stroke}
                strokeLinecap="round"
              />
              <Circle
                testID="chart-range-mean"
                cx={mark.x}
                cy={mark.mean}
                r={Math.max(1, mark.stroke * 0.3)}
                fill={contrast}
              />
            </>
          )}
        </G>
      ))}
      {axisLabelWidth
        ? plot.valueTicks.map(tick => (
            <SvgText
              key={tick.value}
              x={width - 2}
              y={Math.max(fontSize, tick.y + fontSize / 3)}
              textAnchor="end"
              fill={labels}
              fontSize={fontSize}
            >
              {formatRangeAxisValue(tick.value, wholeBpm)}
            </SvgText>
          ))
        : null}
      {groupedTicks?.map(({ label, x }) => (
        <SvgText
          key={label}
          testID="chart-grouped-range-tick"
          accessibilityLabel={label}
          x={x}
          y={height - 5}
          textAnchor="middle"
          fill={labels}
          fontSize={fontSize}
        >
          {label}
        </SvgText>
      ))}
      {!groupedTicks &&
        plot.ticks.map(at => (
          <SvgText
            key={at}
            x={
              plot.first === plot.last
                ? width / 2
                : at === plot.first
                  ? 8
                  : width - 8
            }
            y={height - 5}
            textAnchor={
              plot.first === plot.last
                ? 'middle'
                : at === plot.first
                  ? 'start'
                  : 'end'
            }
            fill={labels}
            fontSize={fontSize}
          >
            {axis === 'day'
              ? formatChartTick(new Date(at).toISOString().slice(0, 10), 'day')
              : formatChartTimeTick(at)}
          </SvgText>
        ))}
    </Svg>
  );
}
