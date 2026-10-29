import { useNavigationSnapshot } from '../navigation/useNavigationSnapshot';
import type { NavigationController } from '../navigation/navigationController';
import type { AppRootTab } from '../navigation/rootTabs';
import type { AppNavigationRoute } from './appNavigationRoute';

/** Tab selection alone stays Home behind a child. Returning from that child must refresh persisted summaries too. */
export function useHomeActivity(
  controller: NavigationController<AppNavigationRoute>,
  tab: AppRootTab,
): boolean {
  const snapshot = useNavigationSnapshot(controller);
  return tab === 'home' && snapshot.currentRoute.name === 'home';
}
