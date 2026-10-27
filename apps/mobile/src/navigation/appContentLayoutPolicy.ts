import type { NavigationRoute } from './navigationController';
import type { NavigationRootTabs } from './rootTabs';

export type NavigationRouteLayoutPolicy<Name extends string> =
  | 'scene'
  | 'screen'
  | ((
      route: NavigationRoute<Name>,
      rootTabs?: NavigationRootTabs,
    ) => 'scene' | 'screen');

/** Gives Schedule, Recording and Visit Questions the full usable lane for their own panel layouts. */
export const appContentLayoutOwner: NavigationRouteLayoutPolicy<string> = (
  route,
  rootTabs,
) => {
  // The root route stays named `home` while Schedule is selected in the tab bar.
  // Recording owns both live-session and consent panels, so it needs the full usable width to reflow.
  return route.name === 'visit-questions' ||
    route.name === 'recording' ||
    (route.name === 'home' && rootTabs?.activeTab === 'schedule')
    ? 'screen'
    : 'scene';
};
