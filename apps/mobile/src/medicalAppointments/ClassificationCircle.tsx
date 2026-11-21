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

export function ClassificationCircleSlot({
  size,
  centerOffset,
  children,
}: {
  readonly size: number;
  readonly centerOffset: number;
  readonly children: ReactNode;
}) {
  return (
    <View
      pointerEvents="box-none"
      testID="classification-circle-slot"
      style={[styles.slot, { top: centerOffset, height: size }]}
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
  slot: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  title: { color: appColors.onPrimary, fontWeight: '700', textAlign: 'center' },
  disabled: { opacity: 0.4 },
});
