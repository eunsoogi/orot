import {
  fitsNavigationRailSegment,
  fitsNavigationRootRail,
  NAVIGATION_CONTEXTUAL_RAIL_CONTROL_HEIGHT,
  NAVIGATION_CONTEXTUAL_RAIL_STACK_SPACING,
  NAVIGATION_ROOT_RAIL_GUTTER,
  NAVIGATION_ROOT_RAIL_WIDTH,
  type NavigationRootLayout,
  type RightNavigationRootLayout,
} from './navigationRootLayout';
import { pageActionRailLayout } from './navigationPageActionLayout';

/** Preserve the measured rail and its keyboard fallback independently from bottom planning. */
export function navigationRailPresentation(
  layout: NavigationRootLayout,
  keyboardHeight: number,
  rootTabs: boolean,
  navigationCount: number,
  actionCount: number,
) {
  const candidate = layout.placement === 'right' ? layout : undefined;
  const height = candidate
    ? Math.max(0, candidate.windowHeight - keyboardHeight)
    : 0;
  const bottomInset =
    candidate && keyboardHeight > 0
      ? NAVIGATION_ROOT_RAIL_GUTTER
      : candidate?.railBottomInset;
  const navFits = candidate
    ? rootTabs
      ? fitsNavigationRootRail(height, candidate.railTopInset, bottomInset ?? 0)
      : fitsNavigationRailSegment(
          height,
          candidate.railTopInset,
          bottomInset ?? 0,
          navigationCount *
            (NAVIGATION_CONTEXTUAL_RAIL_CONTROL_HEIGHT +
              NAVIGATION_CONTEXTUAL_RAIL_STACK_SPACING),
        )
    : false;
  const pageLayout = candidate
    ? pageActionRailLayout({
        height,
        top: candidate.railTopInset,
        bottom: bottomInset ?? 0,
        rootTabs,
        navigationCount,
        actionCount,
      })
    : undefined;
  const rightLayout = navFits && pageLayout?.fits ? candidate : undefined;
  return {
    rightLayout,
    pageLayout,
    height: rightLayout ? height : 0,
    bottomInset: rightLayout ? bottomInset : undefined,
  };
}

/** Keep the window-hosted rail wide enough for its trailing inset. */
export function navigationRailFrameStyle(
  layout: RightNavigationRootLayout | undefined,
  height: number,
) {
  return layout
    ? {
        bottom: 0,
        height,
        position: 'absolute' as const,
        ...(layout.railSide === 'left' ? { left: 0 } : { right: 0 }),
        width:
          (layout.railWidth ?? NAVIGATION_ROOT_RAIL_WIDTH) +
          layout.railRightInset,
      }
    : undefined;
}
