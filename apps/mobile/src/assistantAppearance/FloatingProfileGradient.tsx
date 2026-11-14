import { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  StyleSheet,
  View,
  useColorScheme,
} from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { appColors, appColorPalettes } from '../layout/appColors';

/** Fade the transcript behind the identity without intercepting scrolling or editing. */
export function FloatingProfileGradient() {
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
    void AccessibilityInfo.isReduceTransparencyEnabled()
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
      style={StyleSheet.absoluteFill}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="assistant-floating-gradient"
    >
      {opaque ? (
        <View
          testID="assistant-opaque-backdrop"
          style={[StyleSheet.absoluteFill, styles.opaque]}
        />
      ) : (
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id="profile-fade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={background} stopOpacity={0.85} />
              <Stop offset="0.6" stopColor={background} stopOpacity={0.35} />
              <Stop offset="1" stopColor={background} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#profile-fade)" />
        </Svg>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  opaque: { backgroundColor: appColors.background },
});
