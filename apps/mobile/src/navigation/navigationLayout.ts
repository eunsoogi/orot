/** Four physical screen edges keep safe-area and navigation geometry explicit. */
export interface NavigationEdgeInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/**
 * Separates the viewport area already reserved by the shell from extra scroll
 * padding for a floating bottom action. The right rail belongs to the first
 * group, so applying it again to scroll content would count it twice.
 */
export interface NavigationOcclusion {
  readonly placement: 'bottom' | 'right';
  readonly systemInsets: NavigationEdgeInsets;
  readonly viewportInsets: NavigationEdgeInsets;
  readonly scrollContentInsets: NavigationEdgeInsets;
}

export interface NavigationOcclusionInput {
  readonly placement: NavigationOcclusion['placement'];
  readonly reservedRightWidth: number;
  readonly systemBottomInset: number;
  readonly measuredBottomActionOcclusion: number | null;
  readonly systemInsets: NavigationEdgeInsets;
}

export interface NavigationLayoutFrame {
  readonly y: number;
  readonly height: number;
}

/** Shared layout measurements keep scrollable content clear of native bottom actions. */
export const NAVIGATION_SURFACE_HEIGHT = 48;
export const ROOT_TAB_SURFACE_HEIGHT = 60;
/** Adds room for labels without shrinking root-tab hit areas below a comfortable height. */
export const ROOT_TAB_TOUCH_TARGET_HEIGHT = 52;
/** Reclaims part of the bottom inset; callers keep the system inset when the keyboard is visible. */
export const ROOT_TAB_SAFE_AREA_TRANSLATION = 10;
export const NAVIGATION_ACTION_TOP_PADDING = 4;
export const NAVIGATION_ACTION_BOTTOM_PADDING = 0;
export const NAVIGATION_CONTENT_GAP = 16;
export const BOTTOM_NAVIGATION_CONTENT_INSET =
  NAVIGATION_SURFACE_HEIGHT +
  NAVIGATION_ACTION_TOP_PADDING +
  NAVIGATION_ACTION_BOTTOM_PADDING;

/** Resolves the shell reservation and scroll-only clearance from one geometry result. */
export function resolveNavigationOcclusion({
  placement,
  reservedRightWidth,
  systemBottomInset,
  measuredBottomActionOcclusion,
  systemInsets,
}: NavigationOcclusionInput): NavigationOcclusion {
  const hasRightRail = placement === 'right';
  return {
    placement,
    systemInsets,
    viewportInsets: {
      top: 0,
      right: hasRightRail ? reservedRightWidth : 0,
      bottom: hasRightRail ? systemBottomInset : 0,
      left: 0,
    },
    scrollContentInsets: {
      top: 0,
      right: 0,
      bottom:
        measuredBottomActionOcclusion ??
        BOTTOM_NAVIGATION_CONTENT_INSET +
          (hasRightRail ? 0 : systemInsets.bottom),
      left: 0,
    },
  };
}

/** Measures the action's overlap with usable viewport points after its reserved system edge. */
export function measureNavigationBottomOcclusion(
  viewport: NavigationLayoutFrame,
  bottomAction: NavigationLayoutFrame,
  viewportBottomInset: number,
): number {
  const viewportTop = viewport.y;
  const usableViewportBottom =
    viewport.y + viewport.height - viewportBottomInset;
  const overlapTop = Math.max(viewportTop, bottomAction.y);
  const overlapBottom = Math.min(
    usableViewportBottom,
    bottomAction.y + bottomAction.height,
  );
  return Math.max(0, overlapBottom - overlapTop);
}

/** Adds readable spacing only on occupied edges while keeping the bottom hook contract intact. */
export function navigationContentInsetStyle(
  insets: NavigationEdgeInsets,
  gap: number,
) {
  const style: {
    paddingTop?: number;
    paddingRight?: number;
    paddingBottom: number;
    paddingLeft?: number;
  } = { paddingBottom: insets.bottom + gap };
  if (insets.top > 0) style.paddingTop = insets.top + gap;
  if (insets.right > 0) style.paddingRight = insets.right + gap;
  if (insets.left > 0) style.paddingLeft = insets.left + gap;
  return style;
}
