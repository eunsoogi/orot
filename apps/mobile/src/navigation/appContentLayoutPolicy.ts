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
  route: NavigationRoute<string>,
  rootTabs?: NavigationRootTabs,
): 'scene' | 'screen' => {
  // Root tabs keep the `home` route name while Home, Records, Schedule, or AI owns layout.
  // Provider settings reflows local and connected models within measured regions.
  // Health detail panels resolve against the actual native usable regions.
  // Account management measures its connection and action panels within the full route lane.
  // Appointment entry routes share the screen that measures list and selected-detail panels.
  // Classification measures its overview and candidate panels from usable geometry.
  // The saved library owns a measured list and summary that share that usable geometry.
  // Sync status measures its status and recovery panels against the actual usable regions.
  // Health data settings pairs category choices with sync and permission status panels.
  // The symptom journal shares native usable regions between its list and selected summary.
  // Disease hypotheses keeps its summary actions and evidence on the screen's full usable lane.
  return route.name === 'settings-provider' ||
    route.name === 'settings-accounts' ||
    route.name === 'symptoms' ||
    route.name === 'appointments' ||
    route.name === 'medical-manual' ||
    route.name === 'medical' ||
    route.name === 'health-records' ||
    route.name === 'health-records-detail' ||
    route.name === 'settings-health-data' ||
    route.name === 'saved-recordings' ||
    // Backup status and iCloud recovery guidance use the screen's measured regions as one layout.
    route.name === 'settings-backup' ||
    route.name === 'unified-import' ||
    route.name === 'visit-questions' ||
    // Literature search measures query and selected-source panels across the usable regions.
    route.name === 'external-evidence' ||
    // Conversation history and evidence panels map directly onto the native usable regions.
    route.name === 'rag-conversation' ||
    route.name === 'recording' ||
    // The recording review route already measures playback, transcript, and review panels together.
    route.name === 'recording-review' ||
    route.name === 'settings-privacy' ||
    route.name === 'settings-sync-status' ||
    route.name === 'disease-hypotheses' ||
    (route.name === 'home' &&
      (rootTabs?.activeTab === 'home' ||
        rootTabs?.activeTab === 'records' ||
        rootTabs?.activeTab === 'schedule' ||
        rootTabs?.activeTab === 'ai' ||
        rootTabs?.activeTab === 'settings'))
    ? 'screen'
    : 'scene';
};
