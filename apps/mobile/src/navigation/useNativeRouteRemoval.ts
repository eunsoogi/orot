import {
  CommonActions,
  StackActions,
  type NavigationContainerRefWithCurrent,
} from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { NavigationRoute } from './navigationController';
import type { NativeRouteParamList } from './nativeRouteRegistry';

interface UseNativeRouteRemovalOptions<Name extends string> {
  readonly navigationRef: NavigationContainerRefWithCurrent<NativeRouteParamList>;
  readonly routes: readonly NavigationRoute<Name>[];
  readonly ready: boolean;
  readonly nativeRevision: number;
  readonly reduceMotion: boolean;
  readonly onNativeRouteRemovalComplete?: (routeKey: string) => void;
}

function getRouteKey(params: unknown): string | null {
  if (typeof params !== 'object' || params === null) return null;
  const routeKey = (params as { readonly routeKey?: unknown }).routeKey;
  return typeof routeKey === 'string' ? routeKey : null;
}

function getNativeRouteKeys(
  navigationRef: NavigationContainerRefWithCurrent<NativeRouteParamList>,
): readonly (string | null)[] | null {
  const nativeRoutes = navigationRef.getRootState()?.routes;
  return nativeRoutes?.map(route => getRouteKey(route.params)) ?? null;
}

/** Completes guarded logical removals only after UIKit finishes or Reduce Motion settles. */
export function useNativeRouteRemoval<Name extends string>({
  navigationRef,
  routes,
  ready,
  nativeRevision,
  reduceMotion,
  onNativeRouteRemovalComplete,
}: UseNativeRouteRemovalOptions<Name>) {
  const [syncPending, setSyncPending] = useState(false);
  const pendingNativeRemovals = useRef(new Set<string>());
  const completedNativeTransitions = useRef(new Set<string>());
  const completedNativeStackTransition = useRef(false);
  const observedNativeRouteKeys = useRef<readonly (string | null)[] | null>(
    null,
  );
  const latestRouteKeys = useRef(routes.map(route => route.key));
  const completionCallback = useRef(onNativeRouteRemovalComplete);
  latestRouteKeys.current = routes.map(route => route.key);
  completionCallback.current = onNativeRouteRemovalComplete;

  const readNativeRouteKeys = useCallback(
    () => getNativeRouteKeys(navigationRef),
    [navigationRef],
  );

  const completeSettledNativeRemovals = useCallback(() => {
    if (!ready) return;
    const nativeKeys = readNativeRouteKeys();
    const desiredKeys = latestRouteKeys.current;
    if (
      !nativeKeys ||
      nativeKeys.length !== desiredKeys.length ||
      !nativeKeys.every((key, index) => key === desiredKeys[index])
    ) {
      return;
    }
    observedNativeRouteKeys.current = nativeKeys;

    for (const routeKey of pendingNativeRemovals.current) {
      if (desiredKeys.includes(routeKey) || nativeKeys.includes(routeKey)) {
        pendingNativeRemovals.current.delete(routeKey);
        completedNativeTransitions.current.delete(routeKey);
        continue;
      }
      if (
        !reduceMotion &&
        !completedNativeStackTransition.current &&
        !completedNativeTransitions.current.has(routeKey)
      ) {
        continue;
      }

      pendingNativeRemovals.current.delete(routeKey);
      completedNativeTransitions.current.delete(routeKey);
      completionCallback.current?.(routeKey);
    }
    if (pendingNativeRemovals.current.size === 0) {
      completedNativeStackTransition.current = false;
    }
  }, [readNativeRouteKeys, ready, reduceMotion]);

  const markNativeTransitionComplete = useCallback(
    (routeKey: string, closing: boolean) => {
      const nativeKeys = readNativeRouteKeys();
      const previousNativeKeys = observedNativeRouteKeys.current;
      const removedNativeKeys =
        previousNativeKeys?.filter(key => key && !nativeKeys?.includes(key)) ??
        [];
      for (const key of removedNativeKeys) {
        if (key) pendingNativeRemovals.current.add(key);
      }
      if (
        !pendingNativeRemovals.current.has(routeKey) &&
        !latestRouteKeys.current.includes(routeKey) &&
        !observedNativeRouteKeys.current?.includes(routeKey) &&
        !nativeKeys?.includes(routeKey)
      ) {
        return;
      }

      // A closing event can precede either the route render or stack-state callback.
      if (closing) completedNativeTransitions.current.add(routeKey);
      // UIKit may report the revealed route, rather than a removed route, after a pop.
      if (
        pendingNativeRemovals.current.size > 0 ||
        removedNativeKeys.length > 0
      ) {
        completedNativeStackTransition.current = true;
      }
      if (nativeKeys) observedNativeRouteKeys.current = nativeKeys;
      completeSettledNativeRemovals();
    },
    [completeSettledNativeRemovals, readNativeRouteKeys],
  );

  const trackRemovedRoutes = useCallback(
    (
      nativeKeys: readonly (string | null)[],
      desiredKeys: readonly string[],
    ) => {
      const desiredKeySet = new Set(desiredKeys);
      const previousNativeKeys = observedNativeRouteKeys.current;
      if (previousNativeKeys) {
        for (const key of previousNativeKeys) {
          if (key && !nativeKeys.includes(key)) {
            pendingNativeRemovals.current.add(key);
          }
        }
      }
      for (const key of nativeKeys) {
        if (key && !desiredKeySet.has(key)) {
          pendingNativeRemovals.current.add(key);
        }
      }
      for (const key of completedNativeTransitions.current) {
        if (!desiredKeySet.has(key) && !nativeKeys.includes(key)) {
          pendingNativeRemovals.current.add(key);
        }
      }
      observedNativeRouteKeys.current = nativeKeys;
      completeSettledNativeRemovals();
    },
    [completeSettledNativeRemovals],
  );
  const requestRemovalSync = useCallback(() => setSyncPending(true), []);

  useEffect(() => {
    if (!ready || !syncPending) return;
    const nativeKeys = readNativeRouteKeys();
    if (!nativeKeys?.length) return;

    const desiredKeys = routes.map(route => route.key);
    if (
      nativeKeys.length === desiredKeys.length &&
      nativeKeys.every((key, index) => key === desiredKeys[index])
    ) {
      setSyncPending(false);
      return;
    }

    let sharedPrefix = 0;
    while (
      sharedPrefix < Math.min(nativeKeys.length, desiredKeys.length) &&
      nativeKeys[sharedPrefix] === desiredKeys[sharedPrefix]
    ) {
      sharedPrefix += 1;
    }

    // Descendant leave guards must commit approval before a native removal dispatch.
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
    setSyncPending(false);
  }, [navigationRef, readNativeRouteKeys, ready, routes, syncPending]);

  useEffect(() => {
    completeSettledNativeRemovals();
  }, [completeSettledNativeRemovals, nativeRevision, routes]);

  return {
    markNativeTransitionComplete,
    getNativeRouteKeys: readNativeRouteKeys,
    requestRemovalSync,
    trackRemovedRoutes,
  };
}
