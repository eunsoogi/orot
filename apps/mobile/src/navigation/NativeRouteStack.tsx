import {
  NavigationContainer,
  StackActions,
  useNavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
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
  readonly reduceMotion: boolean;
  readonly canNativeGoBack: (routeKey: string) => boolean;
  readonly renderRoute: (route: NavigationRoute<Name>) => ReactNode;
  readonly onNativeRouteRemovalComplete?: (routeKey: string) => void;
}

/** Mirrors guarded routes into UIKit and applies the shared Reduce Motion setting. */
export function NativeRouteStack<Name extends string>({
  controller,
  routes,
  isTransitioning,
  reduceMotion,
  canNativeGoBack,
  renderRoute,
  onNativeRouteRemovalComplete,
}: NativeRouteStackProps<Name>) {
  const navigationRef = useNavigationContainerRef<NativeRouteParamList>();
  const [ready, setReady] = useState(false);
  const [nativeRevision, setNativeRevision] = useState(0);
  const allowedNativeRemoval = useRef<string | null>(null);
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

  const registry = useMemo<NativeRouteRegistry>(
    () => ({
      routes: routes as readonly NavigationRoute<string>[],
      isTransitioning,
      canNativeGoBack,
      prepareNativeBack: routeKey => {
        allowedNativeRemoval.current = canNativeGoBack(routeKey)
          ? routeKey
          : null;
      },
      requestBack: controller.requestBack,
      renderRoute: route => renderRoute(route as NavigationRoute<Name>),
    }),
    [canNativeGoBack, controller, isTransitioning, renderRoute, routes],
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
        onStateChange={() => {
          const current = controller.getSnapshot().routes;
          const nativeKeys = getNativeRouteKeys();
          const removed = current[current.length - 1];
          // Cancelled gestures keep native state intact. Reconcile only one matching tail removal.
          if (
            removed &&
            nativeKeys?.length === current.length - 1 &&
            nativeKeys.every((key, index) => key === current[index]?.key) &&
            allowedNativeRemoval.current === removed.key
          ) {
            controller.reconcileNativeBack(removed.key);
          }
          allowedNativeRemoval.current = null;
          setNativeRevision(revision => revision + 1);
        }}
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
