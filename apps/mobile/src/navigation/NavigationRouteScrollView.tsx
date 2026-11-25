import type { ComponentRef, ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import {
  NavigationRouteRefreshContext,
  useNavigationRouteRefreshHost,
} from './navigationRouteRefresh';
import { useNavigationContentInset } from './useNavigationContentInset';
import { useNavigationEdgeVerticalScroll } from './navigationEdgeScroll';

interface NavigationRouteScrollPosition {
  readonly preserve: () => void;
  readonly restore: () => void;
  readonly capture: () => (current: () => boolean) => void;
  readonly suspendScroll: () => () => void;
}

const NavigationRouteScrollPositionContext =
  createContext<NavigationRouteScrollPosition | null>(null);

/** Returns scroll preservation for content that temporarily replaces a long route list. */
export function useNavigationRouteScrollPosition() {
  return useContext(NavigationRouteScrollPositionContext);
}

/** Gives a live descendant gesture a temporary lock on this route's scroll host. */
export function useNavigationRouteScrollSuspension() {
  return useNavigationRouteScrollPosition()?.suspendScroll;
}

/** Lets route content fill its viewport and scroll behind the shared glass actions. */
export function NavigationRouteScrollView({
  children,
  pullToRefresh = false,
  testID = 'navigation-route-scroll',
}: {
  readonly children: ReactNode;
  readonly pullToRefresh?: boolean;
  readonly testID?: string;
}) {
  const refresh = useNavigationRouteRefreshHost();
  const navigationInset = useNavigationContentInset();
  const edge = useNavigationEdgeVerticalScroll({
    trailingPadding: navigationInset.paddingRight,
  });
  const scrollViewRef = useRef<ComponentRef<typeof ScrollView> | null>(null);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const scrollHolds = useRef(new Set<symbol>());
  const suspendScroll = useCallback(() => {
    const hold = Symbol();
    scrollHolds.current.add(hold);
    // Block native pan at grant, rather than waiting for React to commit.
    scrollViewRef.current
      ?.getNativeScrollRef()
      ?.setNativeProps({ scrollEnabled: false });
    setScrollEnabled(false);
    return () => {
      if (!scrollHolds.current.delete(hold) || scrollHolds.current.size) return;
      scrollViewRef.current
        ?.getNativeScrollRef()
        ?.setNativeProps({ scrollEnabled: true });
      setScrollEnabled(true);
    };
  }, []);
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
  const capture = useCallback(() => {
    const offset = currentOffset.current;
    return (current: () => boolean) => {
      requestAnimationFrame(() => {
        if (!current()) return;
        scrollViewRef.current?.scrollTo({ x: 0, y: offset, animated: false });
        currentOffset.current = offset;
      });
    };
  }, []);
  const position = useMemo(
    () => ({ preserve, restore, capture, suspendScroll }),
    [preserve, restore, capture, suspendScroll],
  );
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
      <NavigationRouteRefreshContext.Provider
        value={pullToRefresh ? refresh.register : null}
      >
        <ScrollView
          ref={scrollViewRef}
          automaticallyAdjustKeyboardInsets
          {...edge.indicatorProps}
          contentContainerStyle={[
            styles.content,
            navigationInset,
            edge.contentStyle,
          ]}
          keyboardShouldPersistTaps="handled"
          onScroll={updateCurrentOffset}
          refreshControl={
            pullToRefresh ? (
              <RefreshControl
                testID="navigation-route-refresh"
                refreshing={refresh.refreshing}
                onRefresh={refresh.onRefresh}
              />
            ) : undefined
          }
          scrollEnabled={scrollEnabled}
          scrollEventThrottle={16}
          style={[styles.fill, edge.scrollViewStyle]}
          testID={testID}
        >
          {children}
        </ScrollView>
      </NavigationRouteRefreshContext.Provider>
    </NavigationRouteScrollPositionContext.Provider>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1 },
  fill: { flex: 1 },
});
