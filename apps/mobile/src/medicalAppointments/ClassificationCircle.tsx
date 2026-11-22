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
  windowWidth = width,
) {
  const centered = classificationCircleGeometry(width, height, fontScale);
  // A 466pt wide window can leave just 346pt after the rail and route padding.
  // Shrink both moving states equally before sacrificing the readable right pane.
  const laneGap = 16;
  const minimumListWidth = Math.max(224, Math.ceil(224 * fontScale));
  const sideSize = Math.min(centered.size, width - laneGap - minimumListWidth);
  const side =
    windowWidth >= 460 &&
    sideSize >= 104 &&
    height >= Math.max(160, 38 * fontScale + 110);
  const inline = !side && height < 140;
  const size = side
    ? sideSize
    : inline
      ? Math.min(centered.size, 44)
      : centered.size;
  return {
    size,
    centerOffset: side ? (height - size) / 2 : 0,
    captionTop: side ? 0 : size + 8,
    inline,
    side,
    listStart: side ? size + laneGap : 0,
    x: side
      ? (size - width) / 2
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
  windowWidth: number,
) {
  return docked
    ? classificationDockGeometry(width, height, scale, windowWidth)
    : {
        ...classificationCircleGeometry(width, height, scale),
        x: 0,
        listStart: 0,
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
