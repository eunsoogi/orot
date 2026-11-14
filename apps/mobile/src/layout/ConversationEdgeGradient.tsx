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
}: {
  readonly edge: 'top' | 'bottom';
  readonly testID: string;
  /** Stay within the scroll content gutter; opaque accessibility fallbacks never overlap content. */
  readonly fadeOverlap?: number;
}) {
  const scheme = useColorScheme();
  // SVG gradient stops require resolved strings, not UIKit dynamic-color objects.
  const background =
    appColorPalettes[scheme === 'dark' ? 'dark' : 'light'].background;
  const [opaque, setOpaque] = useState(true);
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
  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        { top: opaque || fadeOverlap === 0 ? 0 : -fadeOverlap },
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
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
              <Stop offset="0" stopColor={background} stopOpacity={0.98} />
              <Stop offset="0.6" stopColor={background} stopOpacity={0.78} />
              <Stop offset="1" stopColor={background} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect
            width="100%"
            height="100%"
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
