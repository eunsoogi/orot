export interface NavigationGeometryRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface NavigationGeometryInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export type NavigationReservedRegionKind = 'division' | 'occlusion';

export interface NavigationReservedRegion {
  readonly id: string;
  readonly kind: NavigationReservedRegionKind;
  readonly frame: NavigationGeometryRect;
  readonly margins: NavigationGeometryInsets;
  readonly isActive: boolean;
}

/** Window, viewport and region frames share window coordinates; insets describe the window. */
export interface NavigationGeometryPayload {
  readonly windowBounds: NavigationGeometryRect;
  /** Older full-window payloads omit this; a contracted host must report its own bounds explicitly. */
  readonly viewportBounds?: NavigationGeometryRect;
  readonly safeAreaInsets: NavigationGeometryInsets;
  readonly reservedRegionsSupported: boolean;
  readonly reservedRegions: readonly NavigationReservedRegion[];
  /** UIKit hinge identity persists when the folded display has no division region. */
  readonly hasHinge?: boolean;
  /** Actual mounted side controls, reported after UIKit layout; defaults are used only before measurement. */
  readonly navigationWidth?: number;
  readonly navigationFrame?: NavigationGeometryRect;
}

export interface NavigationGeometrySnapshot extends NavigationGeometryPayload {
  readonly safeAreaFrame: NavigationGeometryRect;
  readonly usableRegions: readonly NavigationGeometryRect[];
}

function isFiniteRect(rect: NavigationGeometryRect): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width >= 0 &&
    rect.height >= 0
  );
}

function isFiniteInsets(insets: NavigationGeometryInsets): boolean {
  return (
    Number.isFinite(insets.top) &&
    Number.isFinite(insets.right) &&
    Number.isFinite(insets.bottom) &&
    Number.isFinite(insets.left)
  );
}

function isNonNegativeInsets(insets: NavigationGeometryInsets): boolean {
  return (
    isFiniteInsets(insets) &&
    insets.top >= 0 &&
    insets.right >= 0 &&
    insets.bottom >= 0 &&
    insets.left >= 0
  );
}

function intersect(
  first: NavigationGeometryRect,
  second: NavigationGeometryRect,
): NavigationGeometryRect | null {
  const x = Math.max(first.x, second.x);
  const y = Math.max(first.y, second.y);
  const right = Math.min(first.x + first.width, second.x + second.width);
  const bottom = Math.min(first.y + first.height, second.y + second.height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

/** Removes one occlusion or division frame while retaining each remaining rectangle. */
function subtractFrame(
  source: NavigationGeometryRect,
  reserved: NavigationGeometryRect,
): NavigationGeometryRect[] {
  const overlap = intersect(source, reserved);
  if (!overlap) return [source];

  const sourceRight = source.x + source.width;
  const sourceBottom = source.y + source.height;
  const overlapRight = overlap.x + overlap.width;
  const overlapBottom = overlap.y + overlap.height;
  return [
    {
      x: source.x,
      y: source.y,
      width: source.width,
      height: overlap.y - source.y,
    },
    {
      x: source.x,
      y: overlapBottom,
      width: source.width,
      height: sourceBottom - overlapBottom,
    },
    {
      x: source.x,
      y: overlap.y,
      width: overlap.x - source.x,
      height: overlap.height,
    },
    {
      x: overlapRight,
      y: overlap.y,
      width: sourceRight - overlapRight,
      height: overlap.height,
    },
  ].filter(rect => rect.width > 0 && rect.height > 0);
}

/**
 * Builds usable content rectangles from the native root-view bounds, all four safe-area edges,
 * and active UIKit reserved-region frames. UIKit's region frame already includes its margins.
 */
export function createNavigationGeometrySnapshot(
  payload: NavigationGeometryPayload,
): NavigationGeometrySnapshot | null {
  if (
    !payload ||
    !isFiniteRect(payload.windowBounds) ||
    payload.windowBounds.width <= 0 ||
    payload.windowBounds.height <= 0 ||
    (payload.viewportBounds !== undefined &&
      !isFiniteRect(payload.viewportBounds)) ||
    !isNonNegativeInsets(payload.safeAreaInsets) ||
    typeof payload.reservedRegionsSupported !== 'boolean' ||
    !Array.isArray(payload.reservedRegions) ||
    (payload.hasHinge !== undefined && typeof payload.hasHinge !== 'boolean') ||
    (payload.navigationWidth !== undefined &&
      (!Number.isFinite(payload.navigationWidth) ||
        payload.navigationWidth <= 0)) ||
    (payload.navigationFrame !== undefined &&
      !isFiniteRect(payload.navigationFrame))
  ) {
    return null;
  }

  const reservedRegions = payload.reservedRegionsSupported
    ? payload.reservedRegions
    : [];
  if (
    reservedRegions.some(
      region =>
        !region ||
        typeof region.id !== 'string' ||
        (region.kind !== 'division' && region.kind !== 'occlusion') ||
        typeof region.isActive !== 'boolean' ||
        !isFiniteRect(region.frame) ||
        !isFiniteInsets(region.margins),
    )
  ) {
    return null;
  }

  const { windowBounds, safeAreaInsets } = payload;
  const safeAreaFrame = {
    x: windowBounds.x + safeAreaInsets.left,
    y: windowBounds.y + safeAreaInsets.top,
    width: Math.max(
      0,
      windowBounds.width - safeAreaInsets.left - safeAreaInsets.right,
    ),
    height: Math.max(
      0,
      windowBounds.height - safeAreaInsets.top - safeAreaInsets.bottom,
    ),
  };

  // A route host may already exclude a safe edge. Clip once in window space,
  // retaining the actual window safe frame for consumers that place custom bars.
  const contentFrame = intersect(
    safeAreaFrame,
    payload.viewportBounds ?? windowBounds,
  );
  let usableRegions = contentFrame ? [contentFrame] : [];
  for (const region of reservedRegions) {
    if (!region.isActive) continue;
    usableRegions = usableRegions.flatMap(rect =>
      subtractFrame(rect, region.frame),
    );
  }
  usableRegions.sort(
    (first, second) => first.y - second.y || first.x - second.x,
  );

  return {
    ...payload,
    reservedRegions,
    safeAreaFrame,
    usableRegions,
  };
}
