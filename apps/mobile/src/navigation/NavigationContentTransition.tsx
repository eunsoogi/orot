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

/** Keeps outgoing root content mounted until a short translation makes room for the selected tab. */
export function NavigationContentTransition({
  transitionKey,
  children,
}: NavigationContentTransitionProps) {
  const reduceMotion = useContext(NavigationMotionContext);
  const [displayed, setDisplayed] = useState<DisplayedContent>(() => ({
    transitionKey,
    children,
  }));
  const displayedContent = useRef<DisplayedContent>({
    transitionKey,
    children,
  });
  const [enterPending, setEnterPending] = useState(false);
  // Glass descendants require alpha 1 at every ancestor, including while mounting.
  // Moving the content avoids the offscreen alpha composite that drops UIKit material.
  const offset = useRef(new Animated.Value(0)).current;
  const transitionGeneration = useRef(0);
  const latestContent = useRef({ transitionKey, children });
  latestContent.current = { transitionKey, children };
  if (displayedContent.current.transitionKey !== displayed.transitionKey) {
    displayedContent.current = displayed;
  }
  if (displayed.transitionKey === transitionKey) {
    // Refresh the retained snapshot while this route is still the visible tab.
    displayedContent.current = { transitionKey, children };
  }

  useEffect(() => {
    if (displayed.transitionKey === transitionKey) {
      // Returning to the still-mounted tab cancels its partial movement instead of leaving it displaced.
      if (!enterPending) {
        offset.stopAnimation();
        offset.setValue(0);
      }
      return;
    }
    if (reduceMotion) {
      offset.stopAnimation();
      offset.setValue(0);
      setEnterPending(false);
      setDisplayed(latestContent.current);
      return;
    }

    const generation = ++transitionGeneration.current;
    const exitMotion = Animated.timing(offset, {
      toValue: -4,
      duration: 90,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    exitMotion.start(({ finished }) => {
      if (!finished || transitionGeneration.current !== generation) return;
      setDisplayed(latestContent.current);
      setEnterPending(true);
    });

    return () => {
      // A newer tab target must supersede this completion callback.
      transitionGeneration.current += 1;
      exitMotion.stop();
    };
  }, [
    displayed.transitionKey,
    enterPending,
    offset,
    reduceMotion,
    transitionKey,
  ]);

  useEffect(() => {
    if (!enterPending) return;
    if (reduceMotion) {
      offset.setValue(0);
      setEnterPending(false);
      return;
    }
    if (displayed.transitionKey !== transitionKey) return;

    const enterMotion = Animated.timing(offset, {
      toValue: 0,
      duration: 140,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    enterMotion.start(({ finished }) => {
      if (finished) setEnterPending(false);
    });
    return () => enterMotion.stop();
  }, [
    displayed.transitionKey,
    enterPending,
    offset,
    reduceMotion,
    transitionKey,
  ]);

  const transitionPending =
    displayed.transitionKey !== transitionKey || enterPending;

  return (
    <Animated.View
      testID="navigation-content-transition"
      accessibilityElementsHidden={transitionPending}
      importantForAccessibility={
        transitionPending ? 'no-hide-descendants' : 'auto'
      }
      pointerEvents={transitionPending ? 'none' : 'auto'}
      style={[styles.fill, { transform: [{ translateY: offset }] }]}
    >
      {displayed.transitionKey === transitionKey
        ? children
        : displayedContent.current.children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1, opacity: 1 } });
