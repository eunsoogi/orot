import { Animated, StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';

/** Fade through the system background without changing a native glass ancestor's alpha. */
export function NavigationFadeVeil({
  opacity,
}: {
  readonly opacity: Animated.Value;
}) {
  return (
    <Animated.View
      testID="navigation-fade-veil"
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, styles.veil, { opacity }]}
    />
  );
}

const styles = StyleSheet.create({
  veil: { backgroundColor: appColors.background },
});
