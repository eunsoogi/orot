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
import {
  useNavigationContentInset,
  useNavigationOcclusion,
} from './useNavigationContentInset';
import { useNavigationRightScrollEdge } from './navigationScrollEdge';

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
}: {
  readonly children: ReactNode;
}) {
  const navigationInset = useNavigationContentInset();
  const { right, top } = useNavigationRightScrollEdge();
  const indicatorBottom = useNavigationOcclusion().scrollContentInsets.bottom;
  const scrollEdge = right > 0 ? { marginRight: -right } : undefined;
  const edgePadding =
    right > 0
      ? { paddingRight: (navigationInset.paddingRight ?? 0) + right }
      : undefined;
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
        automaticallyAdjustsScrollIndicatorInsets={
          right > 0 ? false : undefined
        }
        scrollIndicatorInsets={
          right > 0
            ? { top, right: 0, bottom: indicatorBottom, left: 0 }
            : undefined
        }
        contentContainerStyle={[styles.content, navigationInset, edgePadding]}
        keyboardShouldPersistTaps="handled"
        onScroll={updateCurrentOffset}
        scrollEventThrottle={16}
        style={[styles.fill, scrollEdge]}
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
