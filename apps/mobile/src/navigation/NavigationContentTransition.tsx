import { useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';
import { NavigationFadeVeil } from './NavigationFadeVeil';
import { NavigationMotionContext } from './NavigationMotionContext';

interface NavigationContentTransitionProps {
  readonly transitionKey: string;
  readonly children: ReactNode;
}

interface DisplayedContent {
  readonly transitionKey: string;
  readonly children: ReactNode;
}

/** Keeps outgoing root content mounted until a short fade to the background makes room for the selected tab. */
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
  // A sibling veil fades the content without alpha-compositing its UIKit material.
  const veilOpacity = useRef(new Animated.Value(0)).current;
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
      // Returning to the still-mounted tab cancels its partial fade instead of leaving it covered.
      if (!enterPending) {
        veilOpacity.stopAnimation();
        veilOpacity.setValue(0);
      }
      return;
    }
    if (reduceMotion) {
      veilOpacity.stopAnimation();
      veilOpacity.setValue(0);
      setEnterPending(false);
      setDisplayed(latestContent.current);
      return;
    }

    const generation = ++transitionGeneration.current;
    const exitMotion = Animated.timing(veilOpacity, {
      toValue: 1,
      duration: 100,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    exitMotion.start(({ finished }) => {
      if (!finished || transitionGeneration.current !== generation) return;
      // Swap only when covered, then reveal the incoming content without moving it.
      veilOpacity.setValue(1);
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
    veilOpacity,
    reduceMotion,
    transitionKey,
  ]);

  useEffect(() => {
    if (!enterPending) return;
    if (reduceMotion) {
      veilOpacity.setValue(0);
      setEnterPending(false);
      return;
    }
    if (displayed.transitionKey !== transitionKey) return;

    let active = true;
    const enterMotion = Animated.timing(veilOpacity, {
      toValue: 0,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    enterMotion.start(({ finished }) => {
      if (finished && active) setEnterPending(false);
    });
    return () => {
      active = false;
      enterMotion.stop();
    };
  }, [
    displayed.transitionKey,
    enterPending,
    veilOpacity,
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
      style={styles.fill}
    >
      {displayed.transitionKey === transitionKey
        ? children
        : displayedContent.current.children}
      <NavigationFadeVeil opacity={veilOpacity} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1, opacity: 1 } });
