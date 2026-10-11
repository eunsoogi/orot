import {
  CommonActions,
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
}

/** Mirrors the guarded app stack into UIKit's native navigation controller. */
export function NativeRouteStack<Name extends string>({
  controller,
  routes,
  isTransitioning,
  renderRoute,
}: NativeRouteStackProps<Name>) {
  const navigationRef = useNavigationContainerRef<NativeRouteParamList>();
  const [ready, setReady] = useState(false);
  const [nativeRevision, setNativeRevision] = useState(0);
  const [removalSyncPending, setRemovalSyncPending] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const initialRouteKey = useRef(routes[0]?.key);

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
    const nativeRoutes = navigationRef.getRootState()?.routes;
    if (!nativeRoutes?.length) return;

    const nativeKeys = nativeRoutes.map(item => {
      const params = item.params as { readonly routeKey?: unknown } | undefined;
      const routeKey = params?.routeKey;
      return typeof routeKey === 'string' ? routeKey : null;
    });
    const desiredKeys = routes.map(item => item.key);
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

    setRemovalSyncPending(true);
  }, [navigationRef, nativeRevision, ready, routes]);

  useEffect(() => {
    if (!ready || !removalSyncPending) return;
    const nativeRoutes = navigationRef.getRootState()?.routes;
    if (!nativeRoutes?.length) return;

    const nativeKeys = nativeRoutes.map(item => {
      const params = item.params as { readonly routeKey?: unknown } | undefined;
      const routeKey = params?.routeKey;
      return typeof routeKey === 'string' ? routeKey : null;
    });
    const desiredKeys = routes.map(item => item.key);
    if (
      nativeKeys.length === desiredKeys.length &&
      nativeKeys.every((key, index) => key === desiredKeys[index])
    ) {
      setRemovalSyncPending(false);
      return;
    }

    let sharedPrefix = 0;
    while (
      sharedPrefix < Math.min(nativeKeys.length, desiredKeys.length) &&
      nativeKeys[sharedPrefix] === desiredKeys[sharedPrefix]
    ) {
      sharedPrefix += 1;
    }

    // Descendant usePreventRemove hooks must commit their new guard before a native removal dispatch.
    if (
      sharedPrefix === desiredKeys.length &&
      nativeKeys.length > desiredKeys.length
    ) {
      navigationRef.dispatch(
        StackActions.pop(nativeKeys.length - desiredKeys.length),
      );
    } else if (
      nativeKeys.length === desiredKeys.length &&
      sharedPrefix === desiredKeys.length - 1
    ) {
      const nextRoute = routes[desiredKeys.length - 1];
      if (nextRoute) {
        navigationRef.dispatch(
          StackActions.replace('scene', { routeKey: nextRoute.key }),
        );
      }
    } else {
      navigationRef.dispatch(
        CommonActions.reset({
          index: desiredKeys.length - 1,
          routes: desiredKeys.map(routeKey => ({
            name: 'scene' as const,
            params: { routeKey },
          })),
        }),
      );
    }
    setRemovalSyncPending(false);
  }, [navigationRef, ready, removalSyncPending, routes]);

  return (
    <NativeRouteRegistryContext.Provider value={registry}>
      <NavigationContainer
        ref={navigationRef}
        onReady={() => setReady(true)}
        onStateChange={() => setNativeRevision(revision => revision + 1)}
      >
        <Stack.Navigator
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
