import { Pressable, StyleSheet, View } from 'react-native';
import type { ReactNode } from 'react';
import {
  roundPrimaryActionDiameter,
  roundPrimaryActionStyles,
} from '../layout/roundPrimaryActionStyles';
import { appColors } from '../layout/appColors';
import { AppText } from '../layout/AppText';

/** Keep the same stage anchor for the button and progress ring. Short panes
 * reserve their lower half for text; never reduce the action below 44 points
 * when the available pane permits that target. */
export function classificationCircleGeometry(
  width: number,
  height: number,
  fontScale: number,
) {
  const textReserve = Math.min(height * 0.35, 48 + 26 * fontScale);
  const size = Math.max(
    0,
    Math.min(
      roundPrimaryActionDiameter,
      width,
      height,
      Math.max(44, height - 2 * textReserve),
    ),
  );
  const centerOffset = Math.max(0, (height - size) / 2);
  return { size, centerOffset, captionTop: centerOffset + size + 8 };
}

/** Dock only within the measured usable lane, reserving legible space for a
 * complete result row. The compact fallback keeps the existing caption escape. */
export function classificationDockGeometry(
  width: number,
  height: number,
  fontScale: number,
  expandedDuo = false,
) {
  const centered = classificationCircleGeometry(width, height, fontScale);
  // Reserve symmetric breathing room inside the circle's own left column.
  const minimumCircleInset = 16;
  const laneGap = 12;
  const minimumListWidth = Math.max(214, Math.ceil(214 * fontScale));
  const circleInset = Math.max(
    minimumCircleInset,
    Math.min(
      32,
      Math.floor((width - centered.size - laneGap - minimumListWidth) / 2),
    ),
  );
  const side =
    expandedDuo &&
    centered.size >= 104 &&
    width >= centered.size + 2 * circleInset + laneGap + minimumListWidth &&
    height >= Math.max(160, 38 * fontScale + 110);
  const inline = !side && height < 140;
  const size = inline ? Math.min(centered.size, 44) : centered.size;
  // Share only the space left after one complete caption and row. Compact
  // and Dynamic Type panes keep their existing readable fallback.
  const captionHeight = Math.max(44, Math.ceil(38 * fontScale + 4));
  const rowHeight = Math.max(44, Math.ceil(38 * fontScale + 10));
  const stackedInset =
    side || inline
      ? 0
      : Math.max(
          0,
          Math.min(
            16,
            Math.floor((height - size - 8 - captionHeight - rowHeight) / 3),
          ),
        );
  return {
    size,
    centerOffset: side ? (height - size) / 2 : stackedInset,
    captionTop: side ? 0 : size + 8 + 2 * stackedInset,
    bottomInset: stackedInset,
    inline,
    side,
    listStart: side ? 2 * circleInset + size + laneGap : 0,
    x: side
      ? circleInset + (size - width) / 2
      : inline
        ? (size - Math.min(520, width)) / 2
        : 0,
  };
}

/** Repeat confirmation stays in its settled lane; the expanded reader does not. */
export function classificationConfirmationGeometry(
  width: number,
  height: number,
  scale: number,
  docked: boolean,
  expandedDuo: boolean,
) {
  return docked
    ? classificationDockGeometry(width, height, scale, expandedDuo)
    : {
        ...classificationCircleGeometry(width, height, scale),
        x: 0,
        listStart: 0,
        bottomInset: 0,
      };
}

export function ClassificationCircleSlot({
  size,
  centerOffset,
  children,
  paneWidth,
  x = 0,
}: {
  readonly size: number;
  readonly centerOffset: number;
  readonly children: ReactNode;
  readonly x?: number;
  readonly paneWidth?: number;
}) {
  return (
    <View
      pointerEvents="box-none"
      testID="classification-circle-slot"
      style={[
        styles.slot,
        {
          top: centerOffset,
          height: size,
          ...(paneWidth === undefined
            ? { left: 0, right: 0 }
            : { left: (paneWidth - size) / 2, width: size }),
          transform: [{ translateX: x }],
        },
      ]}
    >
      {children}
    </View>
  );
}

export function ClassificationCircleButton({
  size,
  title,
  label,
  disabled,
  onPress,
}: {
  readonly size: number;
  readonly title: string;
  readonly label: string;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  const inner = size * (140 / 160);
  return (
    <Pressable
      testID="medical-appointment-import"
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        roundPrimaryActionStyles.outer,
        { width: size, height: size, borderRadius: size / 2 },
        disabled && styles.disabled,
      ]}
    >
      <View
        style={[
          roundPrimaryActionStyles.inner,
          { width: inner, height: inner, borderRadius: inner / 2 },
        ]}
      >
        <AppText
          allowFontScaling={false}
          style={[styles.title, { fontSize: Math.min(32, size * 0.21) }]}
        >
          {title}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  slot: { position: 'absolute', alignItems: 'center' },
  title: { color: appColors.onPrimary, fontWeight: '700', textAlign: 'center' },
  disabled: { opacity: 0.4 },
});
