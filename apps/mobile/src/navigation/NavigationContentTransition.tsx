import { useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';
import { NavigationMotionContext } from './NavigationMotionContext';

interface NavigationContentTransitionProps {
  readonly transitionKey: string;
  readonly children: ReactNode;
}

interface DisplayedContent {
  readonly transitionKey: string;
  readonly children: ReactNode;
}

/** Keeps outgoing root content mounted until a short fade makes room for the selected tab. */
export function NavigationContentTransition({
  transitionKey,
  children,
}: NavigationContentTransitionProps) {
  const reduceMotion = useContext(NavigationMotionContext);
  const [displayed, setDisplayed] = useState<DisplayedContent>(() => ({
    transitionKey,
    children,
  }));
  const [fadeInPending, setFadeInPending] = useState(false);
  const opacity = useRef(new Animated.Value(1)).current;
  const transitionGeneration = useRef(0);
  const latestContent = useRef({ transitionKey, children });
  latestContent.current = { transitionKey, children };

  useEffect(() => {
    if (displayed.transitionKey === transitionKey) {
      // Returning to the still-mounted tab cancels its partial fade instead of leaving it dimmed.
      if (!fadeInPending) {
        opacity.stopAnimation();
        opacity.setValue(1);
      }
      return;
    }
    if (reduceMotion) {
      opacity.stopAnimation();
      opacity.setValue(1);
      setFadeInPending(false);
      setDisplayed(latestContent.current);
      return;
    }

    const generation = ++transitionGeneration.current;
    const fadeOut = Animated.timing(opacity, {
      toValue: 0,
      duration: 90,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    fadeOut.start(({ finished }) => {
      if (!finished || transitionGeneration.current !== generation) return;
      setDisplayed(latestContent.current);
      setFadeInPending(true);
    });

    return () => {
      // A newer tab target must supersede this completion callback.
      transitionGeneration.current += 1;
      fadeOut.stop();
    };
  }, [
    displayed.transitionKey,
    fadeInPending,
    opacity,
    reduceMotion,
    transitionKey,
  ]);

  useEffect(() => {
    if (!fadeInPending) return;
    if (reduceMotion) {
      opacity.setValue(1);
      setFadeInPending(false);
      return;
    }
    if (displayed.transitionKey !== transitionKey) return;

    const fadeIn = Animated.timing(opacity, {
      toValue: 1,
      duration: 140,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    fadeIn.start(({ finished }) => {
      if (finished) setFadeInPending(false);
    });
    return () => fadeIn.stop();
  }, [
    displayed.transitionKey,
    fadeInPending,
    opacity,
    reduceMotion,
    transitionKey,
  ]);

  const transitionPending =
    displayed.transitionKey !== transitionKey || fadeInPending;

  return (
    <Animated.View
      accessibilityElementsHidden={transitionPending}
      importantForAccessibility={
        transitionPending ? 'no-hide-descendants' : 'auto'
      }
      pointerEvents={transitionPending ? 'none' : 'auto'}
      style={[styles.fill, { opacity }]}
    >
      {displayed.transitionKey === transitionKey
        ? children
        : displayed.children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
