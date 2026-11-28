import { useContext, useEffect, useRef, type ReactNode } from 'react';
import { Animated, View } from 'react-native';
import { NavigationMotionContext } from '../navigation/NavigationMotionContext';

/** Pulses only the decorative placeholders; each route supplies its own loading announcement. */
export function PulsingSkeleton({
  children,
  testID,
}: {
  readonly children: ReactNode;
  readonly testID?: string;
}) {
  const reduceMotion = useContext(NavigationMotionContext);
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (reduceMotion) return undefined;
    // Native opacity avoids frame-by-frame JS work while local sources are loading.
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.45,
          duration: 700,
          useNativeDriver: true,
          isInteraction: false,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
          isInteraction: false,
        }),
      ]),
    );
    pulse.start();
    return () => {
      pulse.stop();
      opacity.setValue(1);
    };
  }, [opacity, reduceMotion]);

  const visibility = {
    accessibilityElementsHidden: true,
    importantForAccessibility: 'no-hide-descendants' as const,
    pointerEvents: 'none' as const,
    testID,
  };
  return reduceMotion ? (
    <View {...visibility}>{children}</View>
  ) : (
    <Animated.View {...visibility} style={{ opacity }}>
      {children}
    </Animated.View>
  );
}
