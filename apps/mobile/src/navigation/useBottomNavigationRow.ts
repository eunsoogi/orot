import { useCallback, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { useNavigationContentFrame } from './navigationContentFrame';
import type { NavigationGlassAction } from './NavigationGlassSurface';
import type { NavigationRouteAction } from './useNavigationPrimaryAction';

/** Uses only measurements belonging to the current route and window configuration. */
export function useBottomNavigationRow({
  routeKey,
  actions,
  taskActions,
  isRightRail,
  hasRootTabs,
}: {
  routeKey: string;
  actions: readonly NavigationGlassAction[];
  taskActions: readonly NavigationRouteAction[];
  isRightRail: boolean;
  hasRootTabs: boolean;
}) {
  const { width, fontScale } = useWindowDimensions();
  const frame = useNavigationContentFrame();
  const availableWidth = frame?.availableContentFrame.width ?? width;
  const key = JSON.stringify([
    routeKey,
    availableWidth,
    fontScale,
    actions,
    taskActions.map(({ id, label, navigationLabel, systemImageName }) => [
      id,
      label,
      navigationLabel,
      systemImageName,
    ]),
  ]);
  const [metrics, setMetrics] = useState<{
    key: string;
    navigationWidths: number[];
    actionWidths: number[];
    height: number;
  }>();
  const onRowMetrics = useCallback(
    (next: {
      navigationWidths: number[];
      actionWidths: number[];
      height: number;
    }) => {
      if (
        ![...next.navigationWidths, ...next.actionWidths, next.height].every(
          value => Number.isFinite(value) && value >= 0,
        )
      )
        return;
      const value = { ...next, key };
      setMetrics(current =>
        JSON.stringify(current) === JSON.stringify(value) ? current : value,
      );
    },
    [key],
  );
  const navWidth = metrics
    ? 32 +
      (hasRootTabs
        ? Math.max(0, ...metrics.navigationWidths) * actions.length
        : metrics.navigationWidths.reduce((a, b) => a + b, 0)) +
      (hasRootTabs ? Math.max(0, actions.length - 1) * 4 : actions.length * 12)
    : 0;
  const pageWidth = metrics
    ? 16 +
      metrics.actionWidths.reduce((a, b) => a + b, 0) +
      Math.max(0, taskActions.length - 1) * 12
    : 0;
  // Detail navigation keeps Back and Home at the outer edges; the page group
  // occupies only the clear center between those independently mounted controls.
  const backIndex = actions.findIndex(action => action.id === 'back');
  const homeIndex = actions.findIndex(action => action.id === 'home');
  const leftEdge =
    16 + (backIndex >= 0 ? (metrics?.navigationWidths[backIndex] ?? 0) : 0);
  const rightEdge =
    16 + (homeIndex >= 0 ? (metrics?.navigationWidths[homeIndex] ?? 0) : 0);
  const rowWidth = availableWidth - 16;
  const pageLeft =
    leftEdge +
    4 +
    Math.max(0, rowWidth - leftEdge - rightEdge - 8 - pageWidth) / 2;
  const singleRow =
    !isRightRail &&
    taskActions.length > 0 &&
    metrics?.key === key &&
    metrics.navigationWidths.length === actions.length &&
    metrics.actionWidths.length === taskActions.length &&
    (hasRootTabs
      ? navWidth + pageWidth + 8
      : pageWidth + leftEdge + rightEdge + 8) <= rowWidth;
  return {
    navWidth: hasRootTabs ? navWidth : rowWidth,
    pageWidth,
    pageLeft,
    bottomHeight: metrics?.key === key ? metrics.height : 0,
    singleRow,
    onRowMetrics,
  };
}
