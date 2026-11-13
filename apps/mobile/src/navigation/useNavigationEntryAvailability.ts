import { useLayoutEffect } from 'react';
import type { NavigationController } from './navigationController';
import type { NavigationLeaveStateSource } from './navigationRouteContracts';

/** Publish only committed, readable leave state as entry availability. */
export function useNavigationEntryAvailability<Name extends string>(
  controller: NavigationController<Name>,
  routeKey: string,
  getSource: (routeKey: string) => NavigationLeaveStateSource<Name> | undefined,
) {
  useLayoutEffect(
    () => () => controller.setLeaveStateAvailability(routeKey, false),
    [controller, routeKey],
  );
  useLayoutEffect(() => {
    let available = false;
    try {
      const source = getSource(routeKey);
      available = !!source && source.readState().canLeave !== false;
    } catch {
      // An unreadable owner cannot establish that leaving is safe.
    }
    controller.setLeaveStateAvailability(routeKey, available);
  });
}
