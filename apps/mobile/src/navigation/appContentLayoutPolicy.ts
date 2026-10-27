import type { NavigationRoute } from './navigationController';
import type { NavigationRootTabs } from './rootTabs';

export type NavigationRouteLayoutPolicy<Name extends string> =
  | 'scene'
  | 'screen'
  | ((
      route: NavigationRoute<Name>,
      rootTabs?: NavigationRootTabs,
    ) => 'scene' | 'screen');

/** Gives Home, Records, Schedule, Recording, and Visit Questions the full lane for their screen-owned panels. */
export const appContentLayoutOwner: NavigationRouteLayoutPolicy<string> = (
  route,
  rootTabs,
) => {
  // Root tabs retain the `home` route name while Home, Records, or Schedule is selected.
  return route.name === 'visit-questions' ||
    route.name === 'recording' ||
    (route.name === 'home' &&
      (rootTabs?.activeTab === 'home' ||
        rootTabs?.activeTab === 'records' ||
        rootTabs?.activeTab === 'schedule'))
    ? 'screen'
    : 'scene';
};
