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
import { navigationWrappedPlan } from './navigationWrappedPlan';
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
    baselineWidths?: number[];
    heights: number[];
    category?: string;
  }>();
  const [constrained, setConstrained] = useState<typeof metrics>();
  const naturalReady =
    enabled && availableWidth > 0 && metrics?.revision === revision;
  const primaryIndices = taskActions.flatMap((action, index) =>
    action.navigationPriority === 'primary' || action.id === 'primary'
      ? [index]
      : [],
  );
  const allocation = naturalReady
    ? navigationWrappedPlan(
        {
          width: availableWidth,
          navigation: actions,
          navigationWidths: metrics.widths.slice(0, actions.length),
          pageWidths: metrics.widths.slice(actions.length, -1),
          moreWidth: metrics.widths.at(-1)!,
          primaryPageIndices: primaryIndices,
        },
        taskActions.map(action => Boolean(action.systemImageName)),
        metrics.baselineWidths?.slice(actions.length, -1),
        metrics.baselineWidths?.at(-1),
      )
    : undefined;
  const measuredConstrained = allocation?.wrapped
    ? measuredActions.map((action, index) => {
        if (
          index < actions.length ||
          (index === measuredActions.length - 1 && hasRootTabs)
        )
          return action;
        const assigned =
          index === measuredActions.length - 1
            ? allocation.moreWidth
            : allocation.pageWidths[index - actions.length]!;
        return assigned < metrics!.widths[index]!
          ? { ...action, layoutWidth: assigned }
          : action;
      })
    : measuredActions;
  const constrainedRevision = JSON.stringify([
    revision,
    'wrapped',
    measuredConstrained.map(action => action.layoutWidth ?? null),
  ]);
  const requestRevision = allocation?.wrapped ? constrainedRevision : revision;
  const onMetrics: NonNullable<NavigationGlassSurfaceProps['onPageMetrics']> =
    useCallback(
      ({ nativeEvent }) => {
        if (
          nativeEvent.revision !== requestRevision ||
          nativeEvent.widths.length !== measuredActions.length ||
          nativeEvent.heights.length !== measuredActions.length ||
          (nativeEvent.baselineWidths !== undefined &&
            (nativeEvent.baselineWidths.length !== measuredActions.length ||
              !nativeEvent.baselineWidths.every(
                value => Number.isFinite(value) && value >= 44,
              ))) ||
          ![...nativeEvent.widths, ...nativeEvent.heights].every(
            value => Number.isFinite(value) && value > 0,
          )
        )
          return;
        if (allocation?.wrapped && metrics?.category !== nativeEvent.category) {
          setConstrained(undefined);
          setMetrics(undefined);
          return;
        }
        const update = allocation?.wrapped ? setConstrained : setMetrics;
        update(current =>
          JSON.stringify(current) === JSON.stringify(nativeEvent)
            ? current
            : nativeEvent,
        );
      },
      [
        requestRevision,
        measuredActions.length,
        allocation?.wrapped,
        metrics?.category,
      ],
    );
  const activeMetrics = allocation?.wrapped ? constrained : metrics;
  const ready =
    naturalReady &&
    (!allocation?.wrapped || constrained?.revision === constrainedRevision);
  const plan = ready ? allocation?.plan : undefined;
  const overflow =
    plan &&
    (plan.overflowNavigation.length > 0 || plan.overflowPages.length > 0);
  const directNavigation = plan
    ? plan.navigationIndices.length === actions.length
      ? actions
      : plan.navigationIndices.map(index => actions[index]!)
    : [];
  const directPage = plan
    ? plan.pageIndices.map(index => taskActions[index]!)
    : [];
  const visibleHeights = plan
    ? [
        ...plan.navigationIndices.map(index => activeMetrics!.heights[index]!),
        ...plan.pageIndices.map(
          index => activeMetrics!.heights[actions.length + index]!,
        ),
        ...(overflow ? [activeMetrics!.heights.at(-1)!] : []),
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
    pageWidths: plan?.pageIndices.map(
      index => measuredConstrained[actions.length + index]?.layoutWidth,
    ),
    moreWidth: measuredConstrained.at(-1)?.layoutWidth,
    measurement: enabled
      ? { revision: requestRevision, actions: measuredConstrained }
      : undefined,
    onMetrics,
  };
}
