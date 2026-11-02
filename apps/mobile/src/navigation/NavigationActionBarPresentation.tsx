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
import {
  fitsNavigationRailSegment,
  fitsNavigationRootRail,
  NAVIGATION_CONTEXTUAL_RAIL_CONTROL_HEIGHT,
  NAVIGATION_CONTEXTUAL_RAIL_STACK_SPACING,
  NAVIGATION_ROOT_RAIL_GUTTER,
  NAVIGATION_ROOT_RAIL_WIDTH,
  NavigationRootLayoutContext,
} from './navigationRootLayout';
import { NavigationSurfacePosition } from './NavigationSurfacePosition';
import { NavigationPageActionDock } from './NavigationPageActionDock';
import { useBottomNavigationRow } from './useBottomNavigationRow';
import { NavigationBarHost } from './NavigationBarHost';
import { pageActionRailLayout } from './navigationPageActionLayout';
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
  const candidateRightLayout =
    layout.placement === 'right' ? layout : undefined;
  const candidateRailHeight = candidateRightLayout
    ? Math.max(0, candidateRightLayout.windowHeight - keyboardHeight)
    : 0;
  const candidateRailBottomInset =
    candidateRightLayout && keyboardHeight > 0
      ? NAVIGATION_ROOT_RAIL_GUTTER
      : candidateRightLayout?.railBottomInset;
  const hasRootTabs = actions.some(action => action.rootTab);
  const contextualActionCount = actions.filter(
    action => action.id !== 'primary',
  ).length;
  // Native inner actions keep one flexible spacer, so each control also needs
  // one stack gap.
  // Keyboard resizing can remove room for either native stack. Move controls
  // to bottom flow rather than clipping them.
  const navFits = candidateRightLayout
    ? hasRootTabs
      ? fitsNavigationRootRail(
          candidateRailHeight,
          candidateRightLayout.railTopInset,
          candidateRailBottomInset ?? 0,
        )
      : fitsNavigationRailSegment(
          candidateRailHeight,
          candidateRightLayout.railTopInset,
          candidateRailBottomInset ?? 0,
          contextualActionCount *
            (NAVIGATION_CONTEXTUAL_RAIL_CONTROL_HEIGHT +
              NAVIGATION_CONTEXTUAL_RAIL_STACK_SPACING),
        )
    : false;
  const pageLayout = candidateRightLayout
    ? pageActionRailLayout({
        height: candidateRailHeight,
        top: candidateRightLayout.railTopInset,
        bottom: candidateRailBottomInset ?? 0,
        rootTabs: hasRootTabs,
        navigationCount: contextualActionCount,
        actionCount: taskActions.length,
      })
    : undefined;
  const rightLayout =
    navFits && pageLayout?.fits ? candidateRightLayout : undefined;
  const isRightRail = rightLayout !== undefined;
  const laneActions = actions.some(action => action.id === 'primary')
    ? actions.filter(action => action.id !== 'primary')
    : actions;
  const {
    navWidth,
    pageWidth,
    pageLeft,
    bottomHeight,
    singleRow,
    onRowMetrics,
  } = useBottomNavigationRow({
    routeKey,
    actions: laneActions,
    taskActions,
    isRightRail,
    hasRootTabs,
  });
  const railHeight = isRightRail ? candidateRailHeight : 0;
  const railBottomInset = isRightRail ? candidateRailBottomInset : undefined;
  const railFrameStyle = rightLayout
    ? {
        bottom: 0,
        height: railHeight,
        position: 'absolute' as const,
        ...(rightLayout.railSide === 'left' ? { left: 0 } : { right: 0 }),
        // Content may already end before this lane; the native window host
        // still needs the complete fixed-width rail and its trailing gap.
        width:
          (rightLayout.railWidth ?? NAVIGATION_ROOT_RAIL_WIDTH) +
          rightLayout.railRightInset,
      }
    : undefined;
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
  const pageDock = taskActions.length ? (
    <NavigationPageActionDock
      actions={taskActions}
      capacity={isRightRail ? (pageLayout?.capacity ?? 1) : 1}
      compactBottom={singleRow}
      disabled={pageActionsDisabled}
      isDarkAppearance={isDarkAppearance}
      isRail={isRightRail}
      navigationActions={isRightRail ? [] : laneActions}
      onRowMetrics={onRowMetrics}
      key={routeKey}
      routeKey={routeKey}
      surface={Surface}
      surfaceProps={
        rightLayout
          ? {
              layoutMode: rightLayout.railSide ?? 'right',
              railTopInset: rightLayout.railTopInset,
              railBottomInset: pageLayout?.pageBottomInset,
              railRightInset: rightLayout.railRightInset,
              railAvailableHeight: railHeight,
              style: styles.railSurface,
            }
          : { layoutMode: 'bottom', bottomHeight }
      }
    />
  ) : null;
  const surfacePosition = (
    <NavigationSurfacePosition
      reclaimRootTabInset={reclaimRootTabInset && !isRightRail && !singleRow}
      style={
        isRightRail ? styles.fill : singleRow ? { width: navWidth } : undefined
      }
    >
      <Surface
        actions={laneActions}
        onAction={onAction}
        testID={isRightRail ? 'navigation-right-rail' : surfaceTestID}
        style={nativeSurfaceStyle}
        bottomHeight={isRightRail ? undefined : bottomHeight}
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
    />
  );
}
