import { useLayoutEffect, useRef, useState, type ComponentRef } from 'react';
import { View } from 'react-native';
import { useChartTooltip } from './ChartTooltipHost';
import { t } from '../../i18n';
import { ChartRenderer } from './ChartRenderer';
import { chartAccessibilitySummary } from './chartAccessibilitySummary';
import { formatChartPointValue } from './format';
import type { ChartData } from './types';

type Props = {
  data: ChartData;
  width: number;
  height: number;
  title: string;
  testID?: string;
  kind?: 'bar' | 'range';
};

/** A selected bar publishes its measured point to the route's unclipped tooltip host. */
export function ChartBarTooltip({
  data,
  width,
  height,
  title,
  testID,
  kind = 'bar',
}: Props) {
  const tooltip = useChartTooltip();
  const source = useRef<ComponentRef<typeof View>>(null);
  const owner = useRef(Symbol()).current;
  const touchedIndex = useRef(-1);
  const entries = data.series
    .flatMap(series => series.points.map(point => ({ series, point })))
    .sort((a, b) => a.point.x.localeCompare(b.point.x));
  const [selected, setSelected] = useState<number | null>(null);
  const entry = selected === null ? undefined : entries[selected];
  function describe(item: (typeof entries)[number]) {
    return [
      item.point.x,
      item.series.label,
      formatChartPointValue(data.metric, item.point, item.series.unit),
      item.point.partial ? t('chart.partialValue') : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }
  useLayoutEffect(() => () => tooltip?.close(owner), [owner, tooltip]);
  const move = (direction: number) => {
    // Missing values have no bar; VoiceOver still announces their complete description.
    tooltip?.close(owner);
    touchedIndex.current = -1;
    // VoiceOver can inspect missing and zero values even where there is no visible bar.
    setSelected(current =>
      Math.max(
        0,
        Math.min(
          entries.length - 1,
          current === null
            ? direction > 0
              ? 0
              : entries.length - 1
            : current + direction,
        ),
      ),
    );
  };
  return (
    <View
      ref={source}
      collapsable={false}
      testID={testID ? `${testID}-anchor` : undefined}
    >
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={
          entry
            ? describe(entry)
            : chartAccessibilitySummary(data, 'day', title)
        }
        accessibilityHint={t('chart.pointSelectionHint')}
        accessibilityActions={[
          { name: 'increment', label: t('chart.nextPoint') },
          { name: 'decrement', label: t('chart.previousPoint') },
        ]}
        onAccessibilityAction={event => {
          if (event.nativeEvent.actionName === 'increment') move(1);
          if (event.nativeEvent.actionName === 'decrement') move(-1);
        }}
        testID={testID}
      >
        <ChartRenderer
          data={data}
          width={width}
          height={height}
          kind={kind}
          onBarSelect={selection => {
            const index = selection
              ? entries.findIndex(
                  item =>
                    item.series.id === selection.seriesId &&
                    item.point.x === selection.x,
                )
              : -1;
            // SVG range glyphs do not emit Chart Kit's deselect callback.
            if (
              kind === 'range' &&
              index >= 0 &&
              touchedIndex.current === index &&
              tooltip?.owns(owner)
            ) {
              touchedIndex.current = -1;
              setSelected(null);
              tooltip.close(owner);
              return;
            }
            touchedIndex.current = index;
            setSelected(index < 0 ? null : index);
            const picked = entries[index];
            if (selection && picked && source.current) {
              tooltip?.show({
                owner,
                source: source.current,
                point: selection.position,
                text: describe(picked),
                testID: testID ? `${testID}-tooltip` : undefined,
              });
            } else tooltip?.close(owner);
          }}
        />
      </View>
    </View>
  );
}
