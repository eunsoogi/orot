import type { ComponentRef, ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import {
  ScrollView,
  StyleSheet,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useNavigationContentInset } from './useNavigationContentInset';

interface NavigationRouteScrollPosition {
  readonly preserve: () => void;
  readonly restore: () => void;
}

const NavigationRouteScrollPositionContext =
  createContext<NavigationRouteScrollPosition | null>(null);

/** Returns scroll preservation for content that temporarily replaces a long route list. */
export function useNavigationRouteScrollPosition() {
  return useContext(NavigationRouteScrollPositionContext);
}

/** Lets route content fill its viewport and scroll behind the shared glass actions. */
export function NavigationRouteScrollView({
  children,
  keyboardShouldPersistTaps = 'handled',
}: {
  readonly children: ReactNode;
  readonly keyboardShouldPersistTaps?: 'handled' | 'always';
}) {
  const navigationInset = useNavigationContentInset();
  const scrollViewRef = useRef<ComponentRef<typeof ScrollView> | null>(null);
  const currentOffset = useRef(0);
  const preservedOffset = useRef<number | null>(null);
  const restoreFrame = useRef<number | null>(null);
  const preserve = useCallback(() => {
    preservedOffset.current = currentOffset.current;
  }, []);
  const restore = useCallback(() => {
    const offset = preservedOffset.current;
    if (offset === null) return;
    if (restoreFrame.current !== null)
      cancelAnimationFrame(restoreFrame.current);
    restoreFrame.current = requestAnimationFrame(() => {
      restoreFrame.current = null;
      // Wait for the restored list to commit before scrolling so its full range exists.
      scrollViewRef.current?.scrollTo({ x: 0, y: offset, animated: false });
      currentOffset.current = offset;
      preservedOffset.current = null;
    });
  }, []);
  const position = useMemo(() => ({ preserve, restore }), [preserve, restore]);
  const updateCurrentOffset = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      currentOffset.current = event.nativeEvent.contentOffset.y;
    },
    [],
  );

  useEffect(
    () => () => {
      if (restoreFrame.current !== null)
        cancelAnimationFrame(restoreFrame.current);
    },
    [],
  );

  return (
    <NavigationRouteScrollPositionContext.Provider value={position}>
      <ScrollView
        ref={scrollViewRef}
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={[styles.content, navigationInset]}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        onScroll={updateCurrentOffset}
        scrollEventThrottle={16}
        style={styles.fill}
        testID="navigation-route-scroll"
      >
        {children}
      </ScrollView>
    </NavigationRouteScrollPositionContext.Provider>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1 },
  fill: { flex: 1 },
});
