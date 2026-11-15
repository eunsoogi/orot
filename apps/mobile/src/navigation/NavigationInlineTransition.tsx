import { useContext, useLayoutEffect, useRef, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { NavigationFadeVeil } from './NavigationFadeVeil';
import { NavigationMotionContext } from './NavigationMotionContext';

/** Reveals only current content: never retains revoked data or remounts a form to animate navigation. */
export function NavigationInlineTransition({
  transitionKey,
  children,
  style,
}: {
  readonly transitionKey: string;
  readonly children: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useContext(NavigationMotionContext);
  const previous = useRef(transitionKey);
  const veilOpacity = useRef(new Animated.Value(0)).current;
  useLayoutEffect(() => {
    veilOpacity.stopAnimation();
    veilOpacity.setValue(0);
    const changed = previous.current !== transitionKey;
    previous.current = transitionKey;
    if (reduceMotion || !changed) return;
    veilOpacity.setValue(1);
    const movement = Animated.timing(veilOpacity, {
      toValue: 0,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    movement.start();
    return () => movement.stop();
  }, [veilOpacity, reduceMotion, transitionKey]);
  return (
    <Animated.View
      testID="navigation-inline-transition"
      style={[style, styles.surface]}
    >
      {children}
      <NavigationFadeVeil opacity={veilOpacity} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({ surface: { opacity: 1 } });
