import { useCallback, useRef, useState } from 'react';
import type { NavigationController } from './navigationController';
import type { NavigationLeaveStateSource } from './navigationRouteContracts';
import { observeNavigationTest } from './navigationTestObservation';

/** Keep each mounted route's current owner and ignore superseded cleanup. */
export function useRegisteredLeaveStates<Name extends string>(
  controller: NavigationController<Name>,
  leaveState?: NavigationLeaveStateSource<Name>,
) {
  const [, setVersion] = useState(0);
  const fallback = useRef(leaveState);
  const registered = useRef(
    new Map<
      string,
      { token: symbol; source: NavigationLeaveStateSource<Name> }
    >(),
  );
  fallback.current = leaveState;
  const getLeaveStateSource = useCallback(
    (routeKey: string) =>
      registered.current.get(routeKey)?.source ?? fallback.current,
    [],
  );
  const registerLeaveState = useCallback(
    (routeKey: string, source: NavigationLeaveStateSource<Name>) => {
      const registration = { token: Symbol('navigation-leave-state'), source };
      registered.current.set(routeKey, registration);
      observeNavigationTest('leave-state-register', { routeKey });
      setVersion(version => version + 1);
      return () => {
        if (registered.current.get(routeKey)?.token !== registration.token)
          return;
        registered.current.delete(routeKey);
        observeNavigationTest('leave-state-cleanup', {
          routeKey,
          logicalKeys: controller.getSnapshot().routes.map(item => item.key),
        });
        setVersion(version => version + 1);
      };
    },
    [controller],
  );
  return { getLeaveStateSource, registerLeaveState };
}
