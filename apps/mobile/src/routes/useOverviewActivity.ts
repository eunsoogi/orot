import { useNavigationSnapshot } from '../navigation/useNavigationSnapshot';
import type { NavigationController } from '../navigation/navigationController';
import type { AppRootTab } from '../navigation/rootTabs';
import type { AppNavigationRoute } from './appNavigationRoute';

/** Returning from a child refreshes the overview even when its tab remains selected. */
export function useOverviewActivity(
  controller: NavigationController<AppNavigationRoute>,
  tab: AppRootTab,
): boolean {
  const snapshot = useNavigationSnapshot(controller);
  return tab === 'overview' && snapshot.currentRoute.name === 'root';
}
