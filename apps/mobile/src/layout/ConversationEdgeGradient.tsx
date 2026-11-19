import { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  StyleSheet,
  View,
  useColorScheme,
} from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { appColors, appColorPalettes } from './appColors';

/** Shared edge scrim; a sibling decoration never changes the native Glass ancestor alpha. */
export function ConversationEdgeGradient({
  edge,
  testID,
  fadeOverlap = 0,
  solidFadeLength = 0,
}: {
  readonly edge: 'top' | 'bottom';
  readonly testID: string;
  /** Stay within the scroll content gutter; opaque accessibility fallbacks never overlap content. */
  readonly fadeOverlap?: number;
  /** Extend the profile backdrop below its identity before fading to transparent. */
  readonly solidFadeLength?: number;
}) {
  const scheme = useColorScheme();
  // SVG gradient stops require resolved strings, not UIKit dynamic-color objects.
  const background =
    appColorPalettes[scheme === 'dark' ? 'dark' : 'light'].background;
  const [opaque, setOpaque] = useState(true);
  const [size, setSize] = useState<{ width: number; height: number }>();
  useEffect(() => {
    let current = true;
    let notified = false;
    const subscription = AccessibilityInfo.addEventListener(
      'reduceTransparencyChanged',
      value => {
        notified = true;
        setOpaque(value);
      },
    );
    AccessibilityInfo.isReduceTransparencyEnabled()
      .then(value => {
        if (current && !notified) setOpaque(value);
      })
      .catch(() => {});
    return () => {
      current = false;
      subscription.remove();
    };
  }, []);
  const top = opaque || fadeOverlap === 0 ? 0 : -fadeOverlap;
  const solidFade = edge === 'top' ? Math.max(0, solidFadeLength) : 0;
  const solidEnd = size?.height
    ? Math.max(0, (size.height - solidFade) / size.height)
    : 1;
  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        { top, bottom: opaque ? 0 : -solidFade },
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
      onLayout={event => {
        const { width, height } = event.nativeEvent.layout;
        if (!Number.isFinite(width) || !Number.isFinite(height)) return;
        if (width < 0 || height < 0) return;
        setSize(previous =>
          previous?.width === width && previous.height === height
            ? previous
            : { width, height },
        );
      }}
    >
      {opaque ? (
        <View
          testID={`${testID}-opaque`}
          style={[StyleSheet.absoluteFill, styles.opaque]}
        />
      ) : (
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient
              id={`${edge}-conversation-fade`}
              x1="0"
              y1={edge === 'top' ? '0' : '1'}
              x2="0"
              y2={edge === 'top' ? '1' : '0'}
            >
              <Stop
                offset="0"
                stopColor={background}
                stopOpacity={solidFade ? 1 : 0.98}
              />
              <Stop
                offset={solidFade ? String(solidEnd) : '0.6'}
                stopColor={background}
                stopOpacity={solidFade ? 1 : 0.78}
              />
              <Stop offset="1" stopColor={background} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          {/* Native SVG caches percentage paths; explicit panel dimensions invalidate
              the Rect path on resize without remounting identity or transcript state. */}
          <Rect
            width={size?.width ?? '100%'}
            height={size?.height ?? '100%'}
            fill={`url(#${edge}-conversation-fade)`}
          />
        </Svg>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  opaque: { backgroundColor: appColors.background },
});
