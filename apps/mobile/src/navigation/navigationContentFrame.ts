import { createContext, useContext } from 'react';
import type {
  NavigationGeometryRect,
  NavigationGeometrySnapshot,
  NavigationReservedRegion,
} from './navigationGeometry';
import {
  navigationSideLane,
  type NavigationRootLayout,
} from './navigationRootLayout';

/** All rectangles use window points. Consumers measure within availableContentFrame and never deduct insets again. */
export interface NavigationContentFrame {
  readonly windowFrame: NavigationGeometryRect;
  readonly viewportFrame: NavigationGeometryRect;
  readonly reservedRegions: readonly NavigationReservedRegion[];
  readonly side: 'bottom' | 'left' | 'right';
  /** The actual UIKit control frame is unavailable until the mounted surface reports layout. */
  readonly navigationFrame: NavigationGeometryRect | null;
  readonly availableContentFrame: NavigationGeometryRect;
}

export const NavigationContentFrameContext =
  createContext<NavigationContentFrame | null>(null);

/** Shares physical geometry with later page consumers without changing the native window snapshot. */
export function useNavigationContentFrame(): NavigationContentFrame | null {
  return useContext(NavigationContentFrameContext);
}

export function resolveNavigationContentFrame(
  geometry: NavigationGeometrySnapshot | null,
  layout: NavigationRootLayout,
  measuredViewport?: NavigationGeometryRect | null,
): NavigationContentFrame | null {
  if (!geometry) return null;
  const viewport =
    measuredViewport ?? geometry.viewportBounds ?? geometry.windowBounds;
  const safe = geometry.safeAreaFrame;
  // Candidate admission remains independent: observed bottom fallback must not latch the rail off.
  const side =
    geometry.navigationSide ??
    (layout.placement === 'bottom' ? 'bottom' : (layout.railSide ?? 'right'));
  const lane =
    side === 'bottom' ? 0 : navigationSideLane(geometry, side).laneWidth;
  const x = Math.max(
    viewport.x,
    safe.x,
    geometry.windowBounds.x + (side === 'left' ? lane : 0),
  );
  const right = Math.min(
    viewport.x + viewport.width,
    safe.x + safe.width,
    geometry.windowBounds.x +
      geometry.windowBounds.width -
      (side === 'right' ? lane : 0),
  );
  const y = Math.max(viewport.y, safe.y);
  const bottom = Math.min(viewport.y + viewport.height, safe.y + safe.height);
  return {
    windowFrame: geometry.windowBounds,
    viewportFrame: viewport,
    reservedRegions: geometry.reservedRegions,
    side,
    navigationFrame: geometry.navigationFrame ?? null,
    availableContentFrame: {
      x,
      y,
      width: Math.max(0, right - x),
      height: Math.max(0, bottom - y),
    },
  };
}

/** Aligns bottom task actions to the already reserved content frame, including a leading system lane. */
export function useNavigationPrimaryFrame(layout: NavigationRootLayout) {
  const shared = useNavigationContentFrame();
  return {
    width:
      shared?.availableContentFrame.width ??
      (layout.placement === 'right' ? layout.contentWidth : undefined),
    marginLeft: shared
      ? shared.availableContentFrame.x - shared.viewportFrame.x
      : 0,
  };
}
