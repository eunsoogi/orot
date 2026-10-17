import { createContext, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/** Shares the system Reduce Motion setting across route content and navigation controls. */
export const NavigationMotionContext = createContext(false);

/** Tracks the system setting and ignores a stale initial read after a change event. */
export function useNavigationReduceMotion() {
  const [reduceMotion, setReduceMotion] = useState(false);
  const reduceMotionRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    let changeObserved = false;
    const updateReduceMotion = (enabled: boolean) => {
      changeObserved = true;
      if (!mounted || reduceMotionRef.current === enabled) return;
      reduceMotionRef.current = enabled;
      setReduceMotion(enabled);
    };

    // Subscribe before the asynchronous snapshot so a later settings change wins if it returns late.
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      updateReduceMotion,
    );
    AccessibilityInfo.isReduceMotionEnabled().then(
      enabled => {
        if (mounted && !changeObserved) updateReduceMotion(enabled);
      },
      () => undefined,
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}
