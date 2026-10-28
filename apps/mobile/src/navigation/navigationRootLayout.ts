import { createContext } from 'react';
import {
  createNavigationGeometrySnapshot,
  type NavigationGeometrySnapshot,
} from './navigationGeometry';

export const NAVIGATION_ROOT_RAIL_WIDTH = 48;
export const NAVIGATION_ROOT_RAIL_GUTTER = 12;
export const NAVIGATION_MINIMUM_COLUMN_WIDTH = 320;
// Keep aligned with NavigationRootGlassBar.railHeight: five 52pt controls and four 4pt gaps.
export const NAVIGATION_ROOT_RAIL_HEIGHT = 5 * 52 + 4 * 4;
// Mirror fixed control heights and stack spacing from NavigationGlassButton and NavigationGlassView.
export const NAVIGATION_CONTEXTUAL_RAIL_CONTROL_HEIGHT = 48;
export const NAVIGATION_CONTEXTUAL_RAIL_STACK_SPACING = 12;

/** Checks a fixed native control stack against its measured usable vertical segment. */
export function fitsNavigationRailSegment(
  availableHeight: number,
  topInset: number,
  bottomInset: number,
  requiredControlHeight: number,
): boolean {
  return (
    Number.isFinite(availableHeight) &&
    availableHeight >= 0 &&
    Number.isFinite(topInset) &&
    topInset >= 0 &&
    Number.isFinite(bottomInset) &&
    bottomInset >= 0 &&
    Number.isFinite(requiredControlHeight) &&
    requiredControlHeight >= 0 &&
    availableHeight - topInset - bottomInset >= requiredControlHeight
  );
}

/** Checks the fixed native root-tab stack against its full usable vertical segment. */
export function fitsNavigationRootRail(
  availableHeight: number,
  topInset: number,
  bottomInset: number,
): boolean {
  return fitsNavigationRailSegment(
    availableHeight,
    topInset,
    bottomInset,
    NAVIGATION_ROOT_RAIL_HEIGHT,
  );
}

export interface BottomNavigationRootLayout {
  readonly placement: 'bottom';
  readonly reservedRightWidth: 0;
}

export interface RightNavigationRootLayout {
  readonly placement: 'right';
  readonly reservedRightWidth: number;
  readonly contentWidth: number;
  /** Legacy placement discriminator stays stable; side identifies the observed system edge. */
  readonly railSide?: 'left' | 'right';
  readonly reservedLeftWidth?: number;
  readonly railWidth?: number;
  readonly windowHeight: number;
  readonly railTopInset: number;
  readonly railBottomInset: number;
  readonly railRightInset: number;
  /** Keeps route content clear of the system edge without treating the rail as bottom flow. */
  readonly systemBottomInset: number;
}

export type NavigationRootLayout =
  BottomNavigationRootLayout | RightNavigationRootLayout;

export const BOTTOM_NAVIGATION_ROOT_LAYOUT: BottomNavigationRootLayout = {
  placement: 'bottom',
  reservedRightWidth: 0,
};

export const NavigationRootLayoutContext = createContext<NavigationRootLayout>(
  BOTTOM_NAVIGATION_ROOT_LAYOUT,
);

/** Resolves controls and content in window coordinates, consuming each native edge once. */
export function resolveNavigationRootLayout(
  geometry: NavigationGeometrySnapshot | null,
): NavigationRootLayout {
  if (!geometry?.reservedRegionsSupported) return BOTTOM_NAVIGATION_ROOT_LAYOUT;
  const window = geometry.windowBounds;
  const viewport = geometry.viewportBounds ?? window;
  const windowRight = window.x + window.width;
  const windowBottom = window.y + window.height;
  const divisions = geometry.reservedRegions.filter(
    region =>
      region.kind === 'division' &&
      region.frame.width > 0 &&
      region.frame.height > 0 &&
      region.frame.x < windowRight &&
      region.frame.x + region.frame.width > window.x &&
      region.frame.y < windowBottom &&
      region.frame.y + region.frame.height > window.y,
  );
  // OS support and window width do not identify a Duo. A real hinge remains present when closed.
  if (!(geometry.hasHinge ?? divisions.length > 0))
    return BOTTOM_NAVIGATION_ROOT_LAYOUT;
  const side =
    geometry.safeAreaInsets.left > geometry.safeAreaInsets.right
      ? 'left'
      : 'right';
  const width = geometry.navigationWidth ?? NAVIGATION_ROOT_RAIL_WIDTH;
  const laneWidth = Math.max(
    geometry.safeAreaInsets[side],
    width + 2 * NAVIGATION_ROOT_RAIL_GUTTER,
  );
  const railRightInset = (laneWidth - width) / 2;
  const railLeft =
    side === 'right'
      ? windowRight - laneWidth + railRightInset
      : window.x + railRightInset;
  const railRight = railLeft + width;
  const contentLeft = Math.max(
    viewport.x,
    geometry.safeAreaFrame.x,
    side === 'left' ? window.x + laneWidth : window.x,
  );
  const contentRight = Math.min(
    viewport.x + viewport.width,
    geometry.safeAreaFrame.x + geometry.safeAreaFrame.width,
    side === 'right' ? windowRight - laneWidth : windowRight,
  );
  const contentWidth = Math.max(0, contentRight - contentLeft);
  if (contentWidth < NAVIGATION_MINIMUM_COLUMN_WIDTH)
    return BOTTOM_NAVIGATION_ROOT_LAYOUT;

  // Active seams still need a readable content region opposite the controls. Inactive frames never carve panels.
  if (
    divisions.some(
      division =>
        division.isActive &&
        !geometry.usableRegions.some(
          region =>
            region.width >= NAVIGATION_MINIMUM_COLUMN_WIDTH &&
            (side === 'right'
              ? region.x + region.width <= division.frame.x + 1
              : region.x >= division.frame.x + division.frame.width - 1),
        ),
    )
  )
    return BOTTOM_NAVIGATION_ROOT_LAYOUT;
  const railGeometry = createNavigationGeometrySnapshot({
    ...geometry,
    viewportBounds: window,
    safeAreaInsets: { ...geometry.safeAreaInsets, left: 0, right: 0 },
  });
  const segment = railGeometry?.usableRegions
    .filter(
      region =>
        region.x <= railLeft + 0.5 &&
        region.x + region.width >= railRight - 0.5 &&
        region.height >=
          NAVIGATION_ROOT_RAIL_HEIGHT + 2 * NAVIGATION_ROOT_RAIL_GUTTER,
    )
    .sort(
      (first, second) => second.height - first.height || first.y - second.y,
    )[0];
  if (!segment) return BOTTOM_NAVIGATION_ROOT_LAYOUT;
  const railTopInset = segment.y - window.y + NAVIGATION_ROOT_RAIL_GUTTER;
  const railBottomInset =
    windowBottom - segment.y - segment.height + NAVIGATION_ROOT_RAIL_GUTTER;
  const usableBottom = geometry.safeAreaFrame.y + geometry.safeAreaFrame.height;
  return {
    placement: 'right',
    ...(side === 'left'
      ? {
          railSide: side,
          reservedLeftWidth: Math.max(0, contentLeft - viewport.x),
        }
      : {}),
    ...(geometry.navigationWidth !== undefined ? { railWidth: width } : {}),
    reservedRightWidth:
      side === 'right'
        ? Math.max(0, viewport.x + viewport.width - contentRight)
        : 0,
    contentWidth,
    windowHeight: window.height,
    railTopInset,
    railBottomInset,
    railRightInset,
    systemBottomInset: Math.max(0, viewport.y + viewport.height - usableBottom),
  };
}
