import { useLayoutEffect, useRef } from 'react';
import type { NavigationController } from './navigationController';
import { registerNavigationTestStateReader } from './navigationTestObservation';

/** Exposes a live structural getter only while a test observer owns this stack. */
export function useNavigationTestStateReader<Name extends string>(
  controller: NavigationController<Name>,
  ready: boolean,
  getNativeRouteKeys: () => readonly (string | null)[] | null,
) {
  const state = useRef({ ready, getNativeRouteKeys });
  state.current = { ready, getNativeRouteKeys };
  const stackID = useRef<string | null>(null);
  useLayoutEffect(() => {
    let generation = 0;
    const registration = registerNavigationTestStateReader(() => {
      const snapshot = controller.getSnapshot();
      return {
        generation,
        logicalKeys: snapshot.routes.map(route => route.key),
        currentRouteKey: snapshot.currentRoute.key,
        currentRouteName: snapshot.currentRoute.name,
        ready: state.current.ready,
        nativeKeys: state.current.getNativeRouteKeys(),
      };
    });
    // Each controller publication invalidates an in-flight bridge observation.
    const unsubscribe = registration.stackID
      ? controller.subscribe(() => {
          generation += 1;
        })
      : () => {};
    stackID.current = registration.stackID;
    return () => {
      stackID.current = null;
      unsubscribe();
      registration.unregister();
    };
  }, [controller]);
  return stackID;
}
