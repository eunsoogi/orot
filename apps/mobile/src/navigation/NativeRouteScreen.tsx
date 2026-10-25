import { usePreventRemove } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useContext, useEffect, useRef } from 'react';
import type { NavigationRoute } from './navigationController';
import { observeNavigationTest } from './navigationTestObservation';
import {
  NativeRouteRegistryContext,
  type NativeRouteParamList,
} from './nativeRouteRegistry';

type NativeRouteScreenProps = NativeStackScreenProps<
  NativeRouteParamList,
  'scene'
>;

/** Keeps UIKit-originated removals behind the app's current leave guard. */
export default function NativeRouteScreen({
  route,
  navigation,
}: NativeRouteScreenProps) {
  const registry = useContext(NativeRouteRegistryContext);
  if (!registry) {
    throw new Error('The native route stack has no route registry.');
  }

  const routeKey = route.params.routeKey;
  const currentRoute = registry.routes.find(item => item.key === routeKey);
  const lastRoute = useRef<NavigationRoute<string> | null>(
    currentRoute ?? null,
  );
  if (currentRoute) lastRoute.current = currentRoute;

  const registryRef = useRef(registry);
  registryRef.current = registry;
  // Safe routes let UIKit finish or cancel interactively. Dirty routes retain the shared guard.
  usePreventRemove(
    registry.routes.some(item => item.key === routeKey) &&
      !registry.canNativeGoBack(routeKey),
    () => {
      const latest = registryRef.current;
      if (
        latest.routes.some(item => item.key === routeKey) &&
        !latest.isTransitioning
      ) {
        latest.requestBack();
      }
    },
  );

  useEffect(
    () =>
      navigation.addListener('beforeRemove', () => {
        observeNavigationTest('beforeRemove-listener', { routeKey });
        // Capture permission before the native pop unmounts its leave-state owner.
        registryRef.current.prepareNativeBack(routeKey);
      }),
    [navigation, routeKey],
  );

  const retainedRoute = lastRoute.current;
  return retainedRoute ? registry.renderRoute(retainedRoute) : null;
}
