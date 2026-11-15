import { useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { AppText as Text } from '../../layout/AppText';
import { appColors } from '../../layout/appColors';
import { t } from '../../i18n';
import { ChartRenderer } from './ChartRenderer';
import { chartAccessibilitySummary } from './chartAccessibilitySummary';
import { formatChartValue } from './format';
import type { ChartData } from './types';

type Props = {
  data: ChartData;
  width: number;
  height: number;
  title: string;
  testID?: string;
};

/** Overlays a wrapping callout at the native bar anchor without a below-chart row. */
export function ChartBarTooltip({ data, width, height, title, testID }: Props) {
  const { fontScale } = useWindowDimensions();
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [calloutHeight, setCalloutHeight] = useState(0);
  const calloutWidth = Math.min(240 * Math.max(1, fontScale), width);
  const entries = data.series
    .flatMap(series => series.points.map(point => ({ series, point })))
    .sort((a, b) => a.point.x.localeCompare(b.point.x));
  const [selected, setSelected] = useState<number | null>(null);
  const entry = selected === null ? undefined : entries[selected];
  const description = entry
    ? [
        entry.point.x,
        entry.series.label,
        entry.point.value === null
          ? t('chart.missing')
          : formatChartValue(data.metric, entry.point.value, entry.series.unit),
        entry.point.partial ? t('chart.partialValue') : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : undefined;
  const move = (direction: number) => {
    // Missing values have no bar; VoiceOver still announces their complete description.
    setAnchor(null);
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
    <View>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={
          description ?? chartAccessibilitySummary(data, 'day', title)
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
          kind="bar"
          onBarSelect={selection => {
            setAnchor(selection?.position ?? null);
            if (!selection) return setSelected(null);
            const index = entries.findIndex(
              item =>
                item.series.id === selection.seriesId &&
                item.point.x === selection.x,
            );
            setSelected(index < 0 ? null : index);
          }}
        />
      </View>
      {description ? (
        <View
          pointerEvents="none"
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onLayout={event => setCalloutHeight(event.nativeEvent.layout.height)}
          style={[
            styles.callout,
            {
              width: calloutWidth,
              // Clamp at the plot boundary for edge bars and tall values. The
              // overlay never takes touches away from scrolling or deselection.
              left: Math.max(
                0,
                Math.min(
                  width - calloutWidth,
                  (anchor?.x ?? width / 2) - calloutWidth / 2,
                ),
              ),
              top: Math.max(
                0,
                (anchor?.y ?? calloutHeight + 8) - calloutHeight - 8,
              ),
            },
          ]}
          testID={testID ? `${testID}-tooltip` : undefined}
        >
          <Text style={styles.text}>{description}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  callout: {
    position: 'absolute',
    padding: 8,
    borderRadius: 8,
    backgroundColor: appColors.background,
    borderWidth: 1,
    borderColor: appColors.border,
  },
  text: { color: appColors.text, flexShrink: 1 },
});
