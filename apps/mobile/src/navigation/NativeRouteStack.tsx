import {
  NavigationContainer,
  StackActions,
  useNavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import type { ReactNode } from 'react';
import type {
  NavigationController,
  NavigationRoute,
} from './navigationController';
import { appColors } from '../layout/appColors';
import NativeRouteScreen from './NativeRouteScreen';
import { useNativeRouteRemoval } from './useNativeRouteRemoval';
import {
  NativeRouteRegistryContext,
  type NativeRouteParamList,
  type NativeRouteRegistry,
} from './nativeRouteRegistry';

const Stack = createNativeStackNavigator<NativeRouteParamList>();

interface NativeRouteStackProps<Name extends string> {
  readonly controller: NavigationController<Name>;
  readonly routes: readonly NavigationRoute<Name>[];
  readonly isTransitioning: boolean;
  readonly renderRoute: (route: NavigationRoute<Name>) => ReactNode;
  readonly onNativeRouteRemovalComplete?: (routeKey: string) => void;
}

/** Mirrors the guarded app stack into UIKit's native navigation controller. */
export function NativeRouteStack<Name extends string>({
  controller,
  routes,
  isTransitioning,
  renderRoute,
  onNativeRouteRemovalComplete,
}: NativeRouteStackProps<Name>) {
  const navigationRef = useNavigationContainerRef<NativeRouteParamList>();
  const [ready, setReady] = useState(false);
  const [nativeRevision, setNativeRevision] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const initialRouteKey = useRef(routes[0]?.key);
  const {
    getNativeRouteKeys,
    markNativeTransitionComplete,
    requestRemovalSync,
    trackRemovedRoutes,
  } = useNativeRouteRemoval({
    navigationRef,
    routes,
    ready,
    nativeRevision,
    reduceMotion,
    onNativeRouteRemovalComplete,
  });

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then(
      enabled => mounted && setReduceMotion(enabled),
      () => mounted && setReduceMotion(false),
    );
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  const registry = useMemo<NativeRouteRegistry>(
    () => ({
      routes: routes as readonly NavigationRoute<string>[],
      isTransitioning,
      requestBack: controller.requestBack,
      renderRoute: route => renderRoute(route as NavigationRoute<Name>),
    }),
    [controller, isTransitioning, renderRoute, routes],
  );

  useLayoutEffect(() => {
    if (!ready) return;
    const nativeKeys = getNativeRouteKeys();
    if (!nativeKeys?.length) return;
    const desiredKeys = routes.map(item => item.key);
    trackRemovedRoutes(nativeKeys, desiredKeys);
    if (
      nativeKeys.length === desiredKeys.length &&
      nativeKeys.every((key, index) => key === desiredKeys[index])
    ) {
      return;
    }

    const prefixLength = Math.min(nativeKeys.length, desiredKeys.length);
    let sharedPrefix = 0;
    while (
      sharedPrefix < prefixLength &&
      nativeKeys[sharedPrefix] === desiredKeys[sharedPrefix]
    ) {
      sharedPrefix += 1;
    }

    if (
      sharedPrefix === nativeKeys.length &&
      desiredKeys.length > nativeKeys.length
    ) {
      const nextRoute = routes[nativeKeys.length];
      if (nextRoute) {
        navigationRef.dispatch(
          StackActions.push('scene', { routeKey: nextRoute.key }),
        );
      }
      return;
    }

    requestRemovalSync();
  }, [
    getNativeRouteKeys,
    navigationRef,
    nativeRevision,
    ready,
    requestRemovalSync,
    routes,
    trackRemovedRoutes,
  ]);

  return (
    <NativeRouteRegistryContext.Provider value={registry}>
      <NavigationContainer
        ref={navigationRef}
        onReady={() => setReady(true)}
        onStateChange={() => setNativeRevision(revision => revision + 1)}
      >
        <Stack.Navigator
          screenListeners={({ route }) => ({
            transitionEnd: event => {
              const params = route.params as
                { readonly routeKey?: unknown } | undefined;
              const routeKey = params?.routeKey;
              if (typeof routeKey === 'string') {
                // UIKit may report the revealed route as the completed side of a pop.
                markNativeTransitionComplete(routeKey, event.data.closing);
              }
            },
          })}
          screenOptions={{
            animation: reduceMotion ? 'none' : 'default',
            contentStyle: styles.content,
            freezeOnBlur: true,
            gestureEnabled: true,
            headerShown: false,
          }}
        >
          <Stack.Screen
            component={NativeRouteScreen}
            initialParams={{ routeKey: initialRouteKey.current ?? '' }}
            name="scene"
          />
        </Stack.Navigator>
      </NavigationContainer>
    </NativeRouteRegistryContext.Provider>
  );
}

const styles = StyleSheet.create({
  content: { backgroundColor: appColors.background },
});
