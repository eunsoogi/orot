import { useContext } from 'react';
import type { ReactNode } from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';
import {
  NavigationGlassSurface,
  type NavigationGlassAction,
  type NavigationGlassActionEventHandler,
} from './NavigationGlassSurface';
import type {
  NavigationPrimaryAction,
  NavigationSurface,
} from './NavigationActionBar';
import { navigationActionBarStyles as styles } from './navigationActionBarStyles';
import { NavigationRootLayoutContext } from './navigationRootLayout';
import { NavigationSurfacePosition } from './NavigationSurfacePosition';
import { NavigationPageActionDock } from './NavigationPageActionDock';
import { NavigationBottomPageActions } from './NavigationBottomPageActions';
import { useBottomNavigationRow } from './useBottomNavigationRow';
import { useBottomActionMenu } from './useBottomActionMenu';
import { NavigationBarHost } from './NavigationBarHost';
import {
  navigationRailFrameStyle,
  navigationRailPresentation,
} from './navigationRailPresentation';
import { useNavigationAllocationObservation } from './useNavigationAllocationObservation';
import type { NavigationRouteAction } from './useNavigationPrimaryAction';

interface NavigationActionBarPresentationProps {
  readonly actions: readonly NavigationGlassAction[];
  readonly bottomActions: ReactNode;
  readonly isDarkAppearance: boolean;
  readonly keyboardHeight: number;
  readonly keyboardVisible: boolean;
  readonly onAction: NavigationGlassActionEventHandler;
  readonly primaryAction?: NavigationPrimaryAction;
  readonly pageActions?: readonly NavigationRouteAction[];
  readonly pageActionsDisabled?: boolean;
  readonly routeKey?: string;
  readonly reclaimRootTabInset: boolean;
  readonly safeAreaHandledByParent: boolean;
  readonly surface: NavigationSurface;
  readonly availableWidthOverride?: number;
}

/** Keeps one native host mounted while the content lane, rail, and bottom action change size. */
export function NavigationActionBarPresentation({
  actions,
  bottomActions,
  isDarkAppearance,
  keyboardHeight,
  keyboardVisible,
  onAction,
  primaryAction,
  pageActions = [],
  pageActionsDisabled = false,
  routeKey = 'navigation',
  reclaimRootTabInset,
  safeAreaHandledByParent,
  surface: Surface = NavigationGlassSurface,
  availableWidthOverride,
}: NavigationActionBarPresentationProps) {
  const layout = useContext(NavigationRootLayoutContext);
  const taskActions = primaryAction
    ? [
        ...pageActions,
        {
          ...primaryAction,
          id: 'primary',
          disabled:
            primaryAction.disabled ||
            actions.find(action => action.id === 'primary')?.disabled,
        },
      ]
    : pageActions;
  const hasRootTabs = actions.some(action => action.rootTab);
  const contextualActionCount = actions.filter(
    action => action.id !== 'primary',
  ).length;
  const {
    rightLayout,
    pageLayout,
    height: railHeight,
    bottomInset: railBottomInset,
  } = navigationRailPresentation(
    layout,
    keyboardHeight,
    hasRootTabs,
    contextualActionCount,
    taskActions.length,
  );
  const isRightRail = rightLayout !== undefined;
  const laneActions = actions.some(action => action.id === 'primary')
    ? actions.filter(action => action.id !== 'primary')
    : actions;
  const managedBottom =
    !isRightRail && Platform.OS === 'ios' && Surface === NavigationGlassSurface;
  const row = useBottomNavigationRow({
    actions: laneActions,
    taskActions,
    enabled: managedBottom,
    hasRootTabs,
    availableWidthOverride,
  });
  useNavigationAllocationObservation({
    layout,
    keyboardHeight,
    keyboardVisible,
    hasRootTabs,
    pageCount: taskActions.length,
    pageLayout,
    isRightRail,
    bottomStatus: row.status,
  });
  const showMore = useBottomActionMenu({
    routeKey,
    navigation: laneActions,
    pages: taskActions,
    overflowNavigationIds: row.overflowNavigation.map(action => action.id),
    overflowPageIds: row.overflowPages.map(action => action.id),
    disabled: pageActionsDisabled,
    onNavigation: onAction,
  });
  const singleRow = managedBottom && row.status === 'ready';
  const navWidth = row.plan?.navWidth ?? 0;
  const pageWidth = row.plan?.pageWidth ?? 0;
  const pageLeft = row.plan?.pageLeft ?? 0;
  const displayedNavigation = singleRow
    ? hasRootTabs && row.overflow
      ? [
          ...row.directNavigation,
          { ...row.more, disabled: pageActionsDisabled },
        ]
      : row.directNavigation
    : laneActions;
  const railFrameStyle = navigationRailFrameStyle(rightLayout, railHeight);
  const surfaceTestID =
    Surface === NavigationGlassSurface && Platform.OS === 'ios'
      ? 'navigation-bar-native-surface'
      : 'navigation-bar-fallback';
  const railProps = rightLayout
    ? {
        layoutMode: rightLayout.railSide ?? ('right' as const),
        railBottomInset,
        railRightInset: rightLayout.railRightInset,
        railTopInset:
          pageLayout?.navigationTopInset ?? rightLayout.railTopInset,
        railAvailableHeight: railHeight,
      }
    : { layoutMode: 'bottom' as const };
  const nativeSurfaceStyle: StyleProp<ViewStyle> = isRightRail
    ? styles.railSurface
    : undefined;
  const hostStyle: StyleProp<ViewStyle> = isRightRail
    ? [styles.railHost, railFrameStyle]
    : styles.safeArea;
  const pageDock = managedBottom ? (
    singleRow &&
    (row.directPage.length > 0 || (!hasRootTabs && row.overflow)) ? (
      <NavigationBottomPageActions
        actions={row.directPage}
        disabled={pageActionsDisabled}
        height={row.bottomHeight}
        includeMore={!hasRootTabs && row.overflow}
        isDarkAppearance={isDarkAppearance}
        onMore={showMore}
        pageWidths={row.pageWidths}
        moreWidth={row.moreWidth}
        surface={Surface}
      />
    ) : null
  ) : taskActions.length ? (
    <NavigationPageActionDock
      actions={taskActions}
      capacity={isRightRail ? (pageLayout?.capacity ?? 1) : 1}
      disabled={pageActionsDisabled}
      isDarkAppearance={isDarkAppearance}
      isRail={isRightRail}
      key={routeKey}
      routeKey={routeKey}
      surface={Surface}
      surfaceProps={
        rightLayout
          ? {
              layoutMode: rightLayout.railSide ?? 'right',
              railTopInset:
                pageLayout?.pageTopInset ?? rightLayout.railTopInset,
              railBottomInset: pageLayout?.pageBottomInset,
              railRightInset: rightLayout.railRightInset,
              railAvailableHeight: railHeight,
              style: styles.railSurface,
            }
          : { layoutMode: 'bottom' }
      }
    />
  ) : null;
  const surfacePosition = (
    <NavigationSurfacePosition
      reclaimRootTabInset={reclaimRootTabInset && !isRightRail && !pageDock}
      style={
        isRightRail ? styles.fill : singleRow ? { width: navWidth } : undefined
      }
    >
      <Surface
        actions={displayedNavigation}
        onAction={event =>
          event.nativeEvent.id === 'navigation-overflow'
            ? showMore()
            : onAction(event)
        }
        testID={isRightRail ? 'navigation-right-rail' : surfaceTestID}
        style={nativeSurfaceStyle}
        bottomHeight={managedBottom ? row.bottomHeight : undefined}
        pageMetricsRequest={row.measurement}
        onPageMetrics={managedBottom ? row.onMetrics : undefined}
        {...railProps}
      >
        {isRightRail ? null : bottomActions}
      </Surface>
    </NavigationSurfacePosition>
  );
  return (
    <NavigationBarHost
      hasRootTabs={hasRootTabs}
      pageLeft={pageLeft}
      hostStyle={hostStyle}
      isRightRail={isRightRail}
      keyboardVisible={keyboardVisible}
      pageDock={pageDock}
      pageWidth={pageWidth}
      safeAreaHandledByParent={safeAreaHandledByParent}
      singleRow={singleRow}
      surfacePosition={surfacePosition}
      status={
        managedBottom && (row.status === 'pending' || row.status === 'unfit')
          ? row.status
          : undefined
      }
    />
  );
}
