import type { NavigationRoute } from './navigationController';
import type { NavigationRootTabs } from './rootTabs';

export type NavigationRouteLayoutPolicy<Name extends string> =
  | 'scene'
  | 'screen'
  | ((
      route: NavigationRoute<Name>,
      rootTabs?: NavigationRootTabs,
    ) => 'scene' | 'screen');

/** Gives Schedule and Visit Questions the full usable lane for their own panel layouts. */
export const appContentLayoutOwner: NavigationRouteLayoutPolicy<string> = (
  route,
  rootTabs,
) => {
  // The root route stays named `home` while Schedule is selected in the tab bar.
  return route.name === 'visit-questions' ||
    (route.name === 'home' && rootTabs?.activeTab === 'schedule')
    ? 'screen'
    : 'scene';
};
