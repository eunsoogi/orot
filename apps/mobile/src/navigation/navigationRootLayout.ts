import { createContext } from 'react';
import { rootTabItems } from './rootTabs';
import {
  createNavigationGeometrySnapshot,
  type NavigationGeometrySnapshot,
} from './navigationGeometry';
import { resolveNavigationSystemSide } from './navigationSystemSide';
import {
  hasNavigationDuoGeometry,
  navigationDuoDivisions,
} from './navigationDuoGeometry';

export const NAVIGATION_ROOT_RAIL_WIDTH = 48;
export const NAVIGATION_ROOT_RAIL_GUTTER = 12;
export const NAVIGATION_MINIMUM_COLUMN_WIDTH = 320;
// Match native 52pt targets and compact 2pt gaps using the canonical destination count.
export const NAVIGATION_ROOT_RAIL_HEIGHT =
  rootTabItems.length * 52 + Math.max(0, rootTabItems.length - 1) * 2;
// Mirror fixed control heights and stack spacing from NavigationGlassButton and NavigationGlassView.
export const NAVIGATION_CONTEXTUAL_RAIL_CONTROL_HEIGHT = 48;
export const NAVIGATION_CONTEXTUAL_RAIL_STACK_SPACING = 12;
// Contextual Back sits above the unchanged root-tab surface with a 4pt gap.
export const NAVIGATION_ROOT_BACK_GROUP_HEIGHT =
  NAVIGATION_CONTEXTUAL_RAIL_CONTROL_HEIGHT + 4;

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
  hasContextualBack = false,
): boolean {
  return fitsNavigationRailSegment(
    availableHeight,
    topInset,
    bottomInset,
    NAVIGATION_ROOT_RAIL_HEIGHT +
      (hasContextualBack ? NAVIGATION_ROOT_BACK_GROUP_HEIGHT : 0),
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

/** Native control width and the system edge define one lane; callers clip it to their own viewport. */
export function navigationSideLane(
  geometry: NavigationGeometrySnapshot,
  side: 'left' | 'right',
) {
  const width = geometry.navigationWidth ?? NAVIGATION_ROOT_RAIL_WIDTH;
  const laneWidth = Math.max(
    geometry.safeAreaInsets[side],
    width + 2 * NAVIGATION_ROOT_RAIL_GUTTER,
  );
  return { width, laneWidth, edgeInset: (laneWidth - width) / 2 };
}

/** Resolves controls and content in window coordinates, consuming each native edge once. */
export function resolveNavigationRootLayout(
  geometry: NavigationGeometrySnapshot | null,
): NavigationRootLayout {
  if (!geometry || !hasNavigationDuoGeometry(geometry))
    return BOTTOM_NAVIGATION_ROOT_LAYOUT;
  const window = geometry.windowBounds;
  const viewport = geometry.viewportBounds ?? window;
  const windowRight = window.x + window.width;
  const windowBottom = window.y + window.height;
  const divisions = navigationDuoDivisions(geometry);
  const side = resolveNavigationSystemSide(geometry, divisions);
  const {
    width,
    laneWidth,
    edgeInset: centeredInset,
  } = navigationSideLane(geometry, side);
  // Inspect the selected edge in window coordinates without expanding the content reservation.
  const laneStart = side === 'left' ? window.x : windowRight - laneWidth;
  const laneEnd = laneStart + laneWidth;
  const measuredEdgeReservation = geometry.reservedRegions.some(
    region =>
      region.kind === 'occlusion' &&
      region.isActive &&
      region.frame.x <= laneStart + 0.5 &&
      region.frame.x + region.frame.width >= laneEnd - 0.5 &&
      region.frame.y <= window.y &&
      region.frame.y + region.frame.height > window.y,
  );
  const measuredLane =
    side === 'right' &&
    viewport.x === window.x &&
    viewport.y === window.y &&
    viewport.width === window.width &&
    viewport.height === window.height &&
    width === 48 &&
    laneWidth === 84 &&
    measuredEdgeReservation;
  // The user requested the same outer spacing on the observed left Split layout.
  const leftSplit =
    side === 'left' &&
    geometry.hasHinge === true &&
    geometry.safeAreaInsets.left === 0 &&
    geometry.safeAreaInsets.right === 0 &&
    divisions.length === 1 &&
    divisions.some(
      ({ frame, isActive }) =>
        !isActive &&
        frame.height > frame.width &&
        frame.x > window.x + window.width / 2 &&
        Math.abs(frame.y - window.y) <= 0.5 &&
        Math.abs(frame.y + frame.height - windowBottom) <= 0.5 &&
        Math.abs(frame.x + frame.width - windowRight) <= 0.5,
    ) &&
    width === 48 &&
    centeredInset >= 35 / 6;
  const railRightInset =
    centeredInset + (measuredLane || leftSplit ? 35 / 6 : 0);
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
