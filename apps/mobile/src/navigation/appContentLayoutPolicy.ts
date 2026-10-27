import type { NavigationRoute } from './navigationController';
import type { NavigationRootTabs } from './rootTabs';

export type NavigationRouteLayoutPolicy<Name extends string> =
  | 'scene'
  | 'screen'
  | ((
      route: NavigationRoute<Name>,
      rootTabs?: NavigationRootTabs,
    ) => 'scene' | 'screen');

/** Gives screens with their own measured panels the full usable content lane. */
export const appContentLayoutOwner: NavigationRouteLayoutPolicy<string> = (
  route,
  rootTabs,
) => {
  // Root tabs keep the `home` route name while Home, Records, Schedule, or AI owns layout.
  // The nested health-record panels need the full lane to resolve native regions.
  // Both appointment entry routes share one screen that measures list and selected-detail panels.
  return route.name === 'appointments' ||
    route.name === 'medical-manual' ||
    route.name === 'health-records' ||
    route.name === 'unified-import' ||
    route.name === 'visit-questions' ||
    route.name === 'recording' ||
    (route.name === 'home' &&
      (rootTabs?.activeTab === 'home' ||
        rootTabs?.activeTab === 'records' ||
        rootTabs?.activeTab === 'schedule' ||
        rootTabs?.activeTab === 'ai' ||
        rootTabs?.activeTab === 'settings'))
    ? 'screen'
    : 'scene';
};
