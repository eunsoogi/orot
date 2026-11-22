import { useNavigationSnapshot } from '../navigation/useNavigationSnapshot';
import type { NavigationController } from '../navigation/navigationController';
import type { AppRootTab } from '../navigation/rootTabs';
import type { AppNavigationRoute } from './appNavigationRoute';

/** A return to the appropriate root invalidates its previously captured local summaries. */
export function useOverviewActivity(
  controller: NavigationController<AppNavigationRoute>,
  tab: AppRootTab,
) {
  const snapshot = useNavigationSnapshot(controller);
  const root = snapshot.currentRoute.name === 'root';
  return {
    overview: root && tab === 'overview',
    recordings: root && (tab === 'overview' || tab === 'records'),
  };
}
