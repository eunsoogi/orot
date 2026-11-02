import { useCallback, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { useNavigationContentFrame } from './navigationContentFrame';
import type {
  NavigationGlassAction,
  NavigationGlassSurfaceProps,
} from './NavigationGlassSurface';
import {
  navigationMoreDescriptor,
  pageActionDescriptor,
} from './navigationActionDescriptor';
import { navigationBottomPlan } from './navigationBottomPlan';
import type { NavigationRouteAction } from './useNavigationPrimaryAction';

/** One native measurement covers navigation, page actions, and the More target. */
export function useBottomNavigationRow({
  actions,
  taskActions,
  enabled,
  hasRootTabs,
  availableWidthOverride,
}: {
  actions: readonly NavigationGlassAction[];
  taskActions: readonly NavigationRouteAction[];
  enabled: boolean;
  hasRootTabs: boolean;
  availableWidthOverride?: number;
}) {
  const { width, fontScale } = useWindowDimensions();
  const frame = useNavigationContentFrame();
  const availableWidth =
    availableWidthOverride ?? frame?.availableContentFrame.width ?? width;
  const more = navigationMoreDescriptor(hasRootTabs);
  const measuredActions = [
    ...actions,
    ...taskActions.map(action => pageActionDescriptor(action, false, false)),
    more,
  ];
  // Selection and availability do not affect UIKit's measured label geometry.
  // Reuse those measurements across tab changes to preserve the native host.
  const revision = JSON.stringify([
    availableWidth,
    fontScale,
    measuredActions.map(action => {
      const geometry = { ...action };
      delete geometry.selected;
      delete geometry.disabled;
      delete geometry.busy;
      // UIKit measures the presence of an icon, not which SF Symbol is used.
      if (geometry.systemImageName) geometry.systemImageName = 'icon';
      return geometry;
    }),
  ]);
  const [metrics, setMetrics] = useState<{
    revision: string;
    widths: number[];
    heights: number[];
  }>();
  const onMetrics: NonNullable<NavigationGlassSurfaceProps['onPageMetrics']> =
    useCallback(
      ({ nativeEvent }) => {
        if (
          nativeEvent.revision !== revision ||
          nativeEvent.widths.length !== measuredActions.length ||
          nativeEvent.heights.length !== measuredActions.length ||
          ![...nativeEvent.widths, ...nativeEvent.heights].every(
            value => Number.isFinite(value) && value > 0,
          )
        )
          return;
        setMetrics(current =>
          JSON.stringify(current) === JSON.stringify(nativeEvent)
            ? current
            : nativeEvent,
        );
      },
      [revision, measuredActions.length],
    );
  const ready = enabled && availableWidth > 0 && metrics?.revision === revision;
  const primaryIndices = taskActions.flatMap((action, index) =>
    action.navigationPriority === 'primary' || action.id === 'primary'
      ? [index]
      : [],
  );
  const plan = ready
    ? navigationBottomPlan({
        width: availableWidth,
        navigation: actions,
        navigationWidths: metrics.widths.slice(0, actions.length),
        pageWidths: metrics.widths.slice(actions.length, -1),
        moreWidth: metrics.widths.at(-1)!,
        primaryPageIndices: primaryIndices,
      })
    : undefined;
  const overflow =
    plan &&
    (plan.overflowNavigation.length > 0 || plan.overflowPages.length > 0);
  const directNavigation = plan
    ? plan.navigationIndices.map(index => actions[index]!)
    : [];
  const directPage = plan
    ? plan.pageIndices.map(index => taskActions[index]!)
    : [];
  const visibleHeights = plan
    ? [
        ...plan.navigationIndices.map(index => metrics!.heights[index]!),
        ...plan.pageIndices.map(
          index => metrics!.heights[actions.length + index]!,
        ),
        ...(overflow ? [metrics!.heights.at(-1)!] : []),
      ]
    : [];
  return {
    status: !enabled
      ? ('disabled' as const)
      : !ready
        ? ('pending' as const)
        : plan
          ? ('ready' as const)
          : ('unfit' as const),
    plan,
    more,
    overflow: Boolean(overflow),
    directNavigation,
    directPage,
    overflowNavigation: plan
      ? plan.overflowNavigation.map(index => actions[index]!)
      : [],
    overflowPages: plan
      ? plan.overflowPages.map(index => taskActions[index]!)
      : [],
    bottomHeight: Math.max(0, ...visibleHeights),
    measurement: enabled ? { revision, actions: measuredActions } : undefined,
    onMetrics,
  };
}
