import { createContext } from 'react';
import type { NavigationGeometrySnapshot } from './navigationGeometry';

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

/** Uses one measured result for the viewport reservation and the root Glass placement. */
export function resolveNavigationRootLayout(
  geometry: NavigationGeometrySnapshot | null,
): NavigationRootLayout {
  if (!geometry?.reservedRegionsSupported) return BOTTOM_NAVIGATION_ROOT_LAYOUT;

  const railRightInset =
    geometry.safeAreaInsets.right + NAVIGATION_ROOT_RAIL_GUTTER;
  const reservedRightWidth = NAVIGATION_ROOT_RAIL_WIDTH + railRightInset;
  const railLeft =
    geometry.windowBounds.x + geometry.windowBounds.width - reservedRightWidth;
  const railRight = railLeft + NAVIGATION_ROOT_RAIL_WIDTH;
  const windowRight = geometry.windowBounds.x + geometry.windowBounds.width;
  const windowBottom = geometry.windowBounds.y + geometry.windowBounds.height;
  const usableBottom = geometry.safeAreaFrame.y + geometry.safeAreaFrame.height;
  const reachesBottom = (
    region: NavigationGeometrySnapshot['usableRegions'][number],
  ) =>
    region.y + region.height >= usableBottom - 1 &&
    region.height >= geometry.safeAreaFrame.height * 0.6;

  for (const division of geometry.reservedRegions) {
    if (
      division.kind !== 'division' ||
      division.frame.width <= 0 ||
      division.frame.height <= 0 ||
      division.frame.x >= windowRight ||
      division.frame.x + division.frame.width <= geometry.windowBounds.x ||
      division.frame.y >= windowBottom ||
      division.frame.y + division.frame.height <= geometry.windowBounds.y
    ) {
      continue;
    }

    const dividerLeft = division.frame.x;
    const dividerRight = dividerLeft + division.frame.width;
    // An inactive native division declares geometry but does not split content.
    // Allocate the readable column beside the rail within the existing usable
    // rectangle; never manufacture panels from an inactive frame.
    const leftPanelIsReadable = geometry.usableRegions.some(
      region =>
        (division.isActive
          ? region.x + region.width <= dividerLeft + 1 &&
            region.width >= NAVIGATION_MINIMUM_COLUMN_WIDTH
          : Math.min(region.x + region.width, railLeft) - region.x >=
            NAVIGATION_MINIMUM_COLUMN_WIDTH) && reachesBottom(region),
    );
    const rightPanelFitsRail =
      !division.isActive ||
      geometry.usableRegions.some(
        region =>
          region.x >= dividerRight - 1 &&
          region.width >=
            NAVIGATION_ROOT_RAIL_WIDTH + NAVIGATION_ROOT_RAIL_GUTTER &&
          reachesBottom(region),
      );
    if (!leftPanelIsReadable || !rightPanelFitsRail) continue;

    const topRailRegion = geometry.usableRegions
      .filter(
        region =>
          region.x <= railLeft + 1 &&
          region.x + region.width >= railRight - 1 &&
          reachesBottom(region),
      )
      .sort((first, second) => first.y - second.y)[0];
    if (!topRailRegion) continue;

    const railBoundary = Math.max(geometry.safeAreaFrame.y, topRailRegion.y);
    const railTopInset =
      railBoundary - geometry.windowBounds.y + NAVIGATION_ROOT_RAIL_GUTTER;
    const railBottomInset =
      windowBottom - usableBottom + NAVIGATION_ROOT_RAIL_GUTTER;
    if (
      !fitsNavigationRootRail(
        geometry.windowBounds.height,
        railTopInset,
        railBottomInset,
      )
    ) {
      continue;
    }

    return {
      placement: 'right',
      reservedRightWidth,
      contentWidth: geometry.windowBounds.width - reservedRightWidth,
      windowHeight: geometry.windowBounds.height,
      railTopInset,
      railBottomInset,
      railRightInset,
      systemBottomInset: windowBottom - usableBottom,
    };
  }

  return BOTTOM_NAVIGATION_ROOT_LAYOUT;
}
