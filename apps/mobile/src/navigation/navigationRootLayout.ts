import { createContext } from 'react';
import type { NavigationGeometrySnapshot } from './navigationGeometry';

export const NAVIGATION_ROOT_RAIL_WIDTH = 48;
export const NAVIGATION_ROOT_RAIL_GUTTER = 12;
export const NAVIGATION_MINIMUM_COLUMN_WIDTH = 320;

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
  const usableBottom = geometry.safeAreaFrame.y + geometry.safeAreaFrame.height;
  const reachesBottom = (
    region: NavigationGeometrySnapshot['usableRegions'][number],
  ) =>
    region.y + region.height >= usableBottom - 1 &&
    region.height >= geometry.safeAreaFrame.height * 0.6;

  for (const division of geometry.reservedRegions) {
    if (
      !division.isActive ||
      division.kind !== 'division' ||
      division.frame.width <= 0 ||
      division.frame.height < geometry.safeAreaFrame.height * 0.6
    ) {
      continue;
    }

    const dividerLeft = division.frame.x;
    const dividerRight = dividerLeft + division.frame.width;
    const leftPanelIsReadable = geometry.usableRegions.some(
      region =>
        region.x + region.width <= dividerLeft + 1 &&
        region.width >= NAVIGATION_MINIMUM_COLUMN_WIDTH &&
        reachesBottom(region),
    );
    const rightPanelFitsRail = geometry.usableRegions.some(
      region =>
        region.x >= dividerRight - 1 &&
        region.width >=
          NAVIGATION_ROOT_RAIL_WIDTH + NAVIGATION_ROOT_RAIL_GUTTER &&
        reachesBottom(region),
    );
    if (!leftPanelIsReadable || !rightPanelFitsRail) continue;

    const railLeft =
      geometry.windowBounds.x +
      geometry.windowBounds.width -
      railRightInset -
      NAVIGATION_ROOT_RAIL_WIDTH;
    const railRight = railLeft + NAVIGATION_ROOT_RAIL_WIDTH;
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
    const windowBottom = geometry.windowBounds.y + geometry.windowBounds.height;
    return {
      placement: 'right',
      reservedRightWidth,
      contentWidth: geometry.windowBounds.width - reservedRightWidth,
      windowHeight: geometry.windowBounds.height,
      railTopInset:
        railBoundary - geometry.windowBounds.y + NAVIGATION_ROOT_RAIL_GUTTER,
      railBottomInset:
        windowBottom - usableBottom + NAVIGATION_ROOT_RAIL_GUTTER,
      railRightInset,
      systemBottomInset: windowBottom - usableBottom,
    };
  }

  return BOTTOM_NAVIGATION_ROOT_LAYOUT;
}
