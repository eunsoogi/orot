import { usePreventRemove } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useContext, useRef } from 'react';
import type { NavigationRoute } from './navigationController';
import {
  NativeRouteRegistryContext,
  type NativeRouteParamList,
} from './nativeRouteRegistry';

type NativeRouteScreenProps = NativeStackScreenProps<
  NativeRouteParamList,
  'scene'
>;

/** Keeps UIKit-originated removals behind the app's current leave guard. */
export default function NativeRouteScreen({ route }: NativeRouteScreenProps) {
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
  // usePreventRemove lets UIKit gestures consult the same guard as app back buttons.
  usePreventRemove(
    registry.routes.some(item => item.key === routeKey),
    () => {
      const latest = registryRef.current;
      if (
        latest.routes.some(item => item.key === routeKey) &&
        !latest.isTransitioning
      ) {
        void latest.requestBack();
      }
    },
  );

  const retainedRoute = lastRoute.current;
  return retainedRoute ? registry.renderRoute(retainedRoute) : null;
}
