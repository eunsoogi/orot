import type { NavigationGeometrySnapshot } from './navigationGeometry';

/** Reuses native hinge evidence without inferring a device from viewport width or safe insets. */
export function navigationDuoDivisions(
  geometry: NavigationGeometrySnapshot | null,
) {
  if (!geometry?.reservedRegionsSupported) return [];
  const window = geometry.windowBounds;
  if (
    ![window.x, window.y, window.width, window.height].every(Number.isFinite) ||
    window.width <= 0 ||
    window.height <= 0
  )
    return [];
  return geometry.reservedRegions.filter(
    region =>
      region.kind === 'division' &&
      region.frame.width > 0 &&
      region.frame.height > 0 &&
      region.frame.x < window.x + window.width &&
      region.frame.x + region.frame.width > window.x &&
      region.frame.y < window.y + window.height &&
      region.frame.y + region.frame.height > window.y,
  );
}

/** Missing geometry is unknown; only observed native capability selects Duo action ownership. */
export function hasNavigationDuoGeometry(
  geometry: NavigationGeometrySnapshot | null,
): boolean {
  if (!geometry?.reservedRegionsSupported) return false;
  const window = geometry.windowBounds;
  if (
    ![window.x, window.y, window.width, window.height].every(Number.isFinite) ||
    window.width <= 0 ||
    window.height <= 0
  )
    return false;
  return geometry.hasHinge ?? navigationDuoDivisions(geometry).length > 0;
}
