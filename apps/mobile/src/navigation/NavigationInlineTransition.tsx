import { useContext, useLayoutEffect, useRef, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { NavigationMotionContext } from './NavigationMotionContext';

/** Reveals only current content: never retains revoked data or remounts a form to animate navigation. */
export function NavigationInlineTransition({
  transitionKey,
  depth = 0,
  children,
  style,
}: {
  readonly transitionKey: string;
  readonly depth?: number;
  readonly children: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useContext(NavigationMotionContext);
  const previous = useRef({ key: transitionKey, depth });
  const width = useRef(0);
  const translation = useRef(new Animated.Value(0)).current;
  useLayoutEffect(() => {
    translation.stopAnimation();
    translation.setValue(0);
    const changed = previous.current.key !== transitionKey;
    const direction = depth < previous.current.depth ? -1 : 1;
    previous.current = { key: transitionKey, depth };
    if (reduceMotion || !changed) return;
    // Only current content moves. Never retain a revoked outgoing record for an exit animation.
    translation.setValue(direction * width.current);
    const movement = Animated.timing(translation, {
      toValue: 0,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    movement.start();
    return () => movement.stop();
  }, [translation, reduceMotion, transitionKey, depth]);
  return (
    <Animated.View
      testID="navigation-inline-transition"
      onLayout={event => {
        width.current = event.nativeEvent.layout.width;
      }}
      style={[
        style,
        styles.surface,
        { transform: [{ translateX: translation }] },
      ]}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({ surface: { opacity: 1 } });
