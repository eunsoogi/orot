import type { NavigationRoute } from './navigationController';
import type { NavigationRootTabs } from './rootTabs';

export type NavigationRouteLayoutPolicy<Name extends string> =
  | 'scene'
  | 'screen'
  | ((
      route: NavigationRoute<Name>,
      rootTabs?: NavigationRootTabs,
    ) => 'scene' | 'screen');

/** Gives screen-owned panels, including unified health import, the full usable content lane. */
export const appContentLayoutOwner: NavigationRouteLayoutPolicy<string> = (
  route,
  rootTabs,
) => {
  // Root tabs retain the `home` route name while Home, Records, or Schedule is selected.
  return route.name === 'unified-import' ||
    route.name === 'visit-questions' ||
    route.name === 'recording' ||
    (route.name === 'home' &&
      (rootTabs?.activeTab === 'home' ||
        rootTabs?.activeTab === 'records' ||
        rootTabs?.activeTab === 'schedule'))
    ? 'screen'
    : 'scene';
};
