import { useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { ReactNode } from 'react';

const ACTION_LABEL_MIN_WIDTH = 92;
const MINIMUM_TOUCH_TARGET = 44;

/** Measures the local row so scaled action cells wrap within the card width. */
export function AppointmentReminderActionRow({
  children,
  style,
  textScale,
}: {
  readonly children: (minimumCellWidth: number) => ReactNode;
  readonly style?: StyleProp<ViewStyle>;
  readonly textScale: number;
}) {
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  // Cap the scaled label width to this row; AppButton retains its 44pt target.
  const minimumCellWidth =
    measuredWidth === null
      ? MINIMUM_TOUCH_TARGET
      : Math.min(ACTION_LABEL_MIN_WIDTH * textScale, measuredWidth);

  return (
    <View
      onLayout={({ nativeEvent: { layout } }) => {
        const nextWidth = layout.width;
        if (!Number.isFinite(nextWidth) || nextWidth <= 0) return;
        setMeasuredWidth(previous =>
          previous !== null && Math.abs(previous - nextWidth) < 0.5
            ? previous
            : nextWidth,
        );
      }}
      style={[styles.row, style]}
      testID="appointment-reminder-actions"
    >
      {children(minimumCellWidth)}
    </View>
  );
}

/** Applies the shared width threshold while letting each button keep its native target. */
export function AppointmentReminderActionCell({
  children,
  minimumWidth,
}: {
  readonly children: ReactNode;
  readonly minimumWidth: number;
}) {
  return (
    <View style={[styles.cell, { minWidth: minimumWidth }]}>{children}</View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'stretch',
    gap: 8,
    minWidth: 0,
  },
  cell: { flexBasis: 0, flexGrow: 1, flexShrink: 0 },
});
