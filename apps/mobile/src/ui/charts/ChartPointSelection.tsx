import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../../layout/AppText';
import { t } from '../../i18n';
import { formatChartPosition, formatChartValue } from './format';
import type { ChartData, ChartPoint, ChartSeries } from './types';

type PointEntry = {
  series: ChartSeries;
  point: ChartPoint;
  index: number;
};

type Selection = {
  position: number | string;
  entries: PointEntry[];
};

type Props = {
  data?: ChartData;
  axis: 'time' | 'day';
  testID?: string;
};

function pointPosition(value: string, axis: 'time' | 'day') {
  return axis === 'time' ? Date.parse(value) : value;
}

function comparePositions(
  left: number | string,
  right: number | string,
  axis: 'time' | 'day',
) {
  return axis === 'time'
    ? Number(left) - Number(right)
    : String(left).localeCompare(String(right));
}

function selectionsFor(data: ChartData | undefined, axis: 'time' | 'day') {
  const grouped = new Map<number | string, Selection>();
  for (const series of data?.series ?? []) {
    series.points.forEach((point, index) => {
      const position = pointPosition(point.x, axis);
      const selection = grouped.get(position) ?? { position, entries: [] };
      selection.entries.push({ series, point, index });
      grouped.set(position, selection);
    });
  }
  return [...grouped.values()].sort((left, right) =>
    comparePositions(left.position, right.position, axis),
  );
}

function selectedValue(
  data: ChartData,
  series: ChartSeries,
  point: ChartPoint,
) {
  const value =
    point.value === null
      ? t('chart.missing')
      : formatChartValue(data.metric, point.value, series.unit);
  const partial = point.partial ? ` · ${t('chart.partialValue')}` : '';
  return `${series.label}: ${value}${partial} · ${t('chart.source', { source: point.source })}`;
}

/** Keeps one position selected and lets touch or VoiceOver move without dragging the native plot. */
export function ChartPointSelection({ data, axis, testID }: Props) {
  const selections = selectionsFor(data, axis);
  const [selectedPosition, setSelectedPosition] = useState<
    number | string | null
  >(null);
  if (!data || selections.length === 0) return <View testID={testID} />;

  const storedIndex = selections.findIndex(
    selection => selection.position === selectedPosition,
  );
  // New pages and deleted observations start at their latest remaining position.
  const selectedIndex = storedIndex >= 0 ? storedIndex : selections.length - 1;
  const selected = selections[selectedIndex]!;
  const date = formatChartPosition(selected.entries[0]!.point.x, axis);
  const values = selected.entries.map(entry =>
    selectedValue(data, entry.series, entry.point),
  );
  const accessibilityLabel = [
    t('chart.selectedMeasurement'),
    date,
    ...values,
  ].join('. ');
  const moveTo = (index: number) => {
    const target = selections[index];
    if (target) setSelectedPosition(target.position);
  };
  const onAccessibilityAction = (event: {
    nativeEvent: { actionName: string };
  }) => {
    if (event.nativeEvent.actionName === 'increment') moveTo(selectedIndex + 1);
    if (event.nativeEvent.actionName === 'decrement') moveTo(selectedIndex - 1);
  };

  return (
    <View>
      {selections.length > 1 && (
        <View style={styles.controls}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: selectedIndex === 0 }}
            disabled={selectedIndex === 0}
            onPress={() => moveTo(selectedIndex - 1)}
            style={styles.control}
            testID={testID ? `${testID}-previous` : undefined}
          >
            <Text>{t('chart.previousPoint')}</Text>
          </Pressable>
          <Text testID={testID ? `${testID}-position` : undefined}>
            {t('chart.measurementPosition', {
              current: selectedIndex + 1,
              count: selections.length,
            })}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{
              disabled: selectedIndex === selections.length - 1,
            }}
            disabled={selectedIndex === selections.length - 1}
            onPress={() => moveTo(selectedIndex + 1)}
            style={styles.control}
            testID={testID ? `${testID}-next` : undefined}
          >
            <Text>{t('chart.nextPoint')}</Text>
          </Pressable>
        </View>
      )}
      <View
        accessible
        accessibilityActions={
          selections.length > 1
            ? [
                { name: 'decrement', label: t('chart.previousPoint') },
                { name: 'increment', label: t('chart.nextPoint') },
              ]
            : undefined
        }
        accessibilityHint={
          selections.length > 1 ? t('chart.pointSelectionHint') : undefined
        }
        accessibilityLabel={accessibilityLabel}
        accessibilityRole={selections.length > 1 ? 'adjustable' : 'text'}
        accessibilityValue={
          selections.length > 1
            ? {
                min: 1,
                max: selections.length,
                now: selectedIndex + 1,
                text: t('chart.measurementPosition', {
                  current: selectedIndex + 1,
                  count: selections.length,
                }),
              }
            : undefined
        }
        onAccessibilityAction={onAccessibilityAction}
        testID={testID}
      >
        <Text>{date}</Text>
        {selected.entries.map(entry => (
          <Text key={`${entry.series.id}-${entry.point.x}-${entry.index}`}>
            {selectedValue(data, entry.series, entry.point)}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  controls: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  control: { justifyContent: 'center', minHeight: 44, paddingHorizontal: 8 },
});
