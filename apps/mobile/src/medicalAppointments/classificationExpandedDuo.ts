import { useNavigationGeometry } from '../navigation/NavigationGeometryProvider';
import { navigationDuoDivisions } from '../navigation/navigationDuoGeometry';
import type { NavigationGeometrySnapshot } from '../navigation/navigationGeometry';

/** Closed Duo keeps hinge identity but has no division. A flat open window
 * reports an inactive division; both dimensions must describe the current host.
 * A keyboard/resize mismatch safely remains stacked until the sensor agrees. */
export function isClassificationExpandedDuo(
  geometry: NavigationGeometrySnapshot | null,
  window: { readonly width: number; readonly height: number },
): boolean {
  if (
    !geometry ||
    !Number.isFinite(window.width) ||
    !Number.isFinite(window.height) ||
    Math.abs(geometry.windowBounds.width - window.width) > 1 ||
    Math.abs(geometry.windowBounds.height - window.height) > 1
  ) {
    return false;
  }
  const divisions = navigationDuoDivisions(geometry);
  return (
    divisions.length > 0 &&
    geometry.hasHinge !== false &&
    divisions.every(region => !region.isActive)
  );
}

export function useClassificationExpandedDuo(window: {
  readonly width: number;
  readonly height: number;
}): boolean {
  return isClassificationExpandedDuo(useNavigationGeometry(), window);
}
