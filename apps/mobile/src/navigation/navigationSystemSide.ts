import type {
  NavigationGeometrySnapshot,
  NavigationReservedRegion,
} from './navigationGeometry';

/** Keeps existing edge authority and recognizes only the observed zero-inset left split signature. */
export function resolveNavigationSystemSide(
  geometry: NavigationGeometrySnapshot,
  intersectingDivisions: readonly NavigationReservedRegion[],
): 'left' | 'right' {
  const { left, right } = geometry.safeAreaInsets;
  if (left !== right) return left > right ? 'left' : 'right';
  if (left !== 0 || intersectingDivisions.length !== 1) return 'right';
  const [division] = intersectingDivisions;
  if (!division || division.isActive) return 'right';
  const window = geometry.windowBounds;
  const seam = division.frame;
  // UIKit includes margins in the region frame. Never expand this frame or
  // reserve its inactive area. The clipped right-edge seam was independently
  // observed in the left Split View window; this is a bounded app policy,
  // not a claim that every division or equal inset identifies window position.
  const observedLeftSplit =
    seam.height > seam.width &&
    seam.x > window.x + window.width / 2 &&
    Math.abs(seam.y - window.y) <= 0.5 &&
    Math.abs(seam.y + seam.height - window.y - window.height) <= 0.5 &&
    Math.abs(seam.x + seam.width - window.x - window.width) <= 0.5;
  return observedLeftSplit ? 'left' : 'right';
}
