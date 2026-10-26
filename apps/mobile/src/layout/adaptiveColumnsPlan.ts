import type { NavigationGeometryRect } from '../navigation/navigationGeometry';
import type { NavigationOcclusion } from '../navigation/navigationLayout';
import { NAVIGATION_MINIMUM_COLUMN_WIDTH } from '../navigation/navigationRootLayout';

export const ADAPTIVE_COLUMN_GAP = 24;
// Match the root navigation's minimum height for regions that can host side-by-side panels.
const FULL_HEIGHT_REGION_RATIO = 0.6;

export interface AdaptiveColumnsInput {
  readonly windowWidth: number;
  readonly fontScale: number;
  readonly systemInsets: NavigationOcclusion['systemInsets'];
  readonly viewportInsets: NavigationOcclusion['viewportInsets'];
  readonly measuredBounds?: {
    readonly x: number;
    readonly width: number;
  } | null;
  readonly safeAreaFrame?: NavigationGeometryRect | null;
  readonly usableRegions?: readonly NavigationGeometryRect[];
  readonly hasNativeDivision?: boolean;
  readonly hasNativeOcclusion?: boolean;
  readonly minColumnWidth?: number;
  readonly columnGap?: number;
  readonly hasSecondary: boolean;
}

export interface AdaptiveColumnsPlan {
  readonly columns: 1 | 2;
  readonly contentWidth: number;
  readonly leadingInset: number;
  readonly primaryWidth: number;
  readonly secondaryWidth: number;
  readonly columnGap: number;
  readonly rowGap: number;
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function positive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function validRegions(
  regions: readonly NavigationGeometryRect[] | undefined,
): NavigationGeometryRect[] {
  return (regions ?? []).filter(
    region =>
      Number.isFinite(region.x) &&
      Number.isFinite(region.y) &&
      Number.isFinite(region.width) &&
      Number.isFinite(region.height) &&
      region.width > 0 &&
      region.height > 0,
  );
}

/** Chooses panels without crossing a native division or double-counting the shell rail. */
export function resolveAdaptiveColumns({
  windowWidth,
  fontScale,
  systemInsets,
  viewportInsets,
  measuredBounds,
  safeAreaFrame,
  usableRegions,
  hasNativeDivision = false,
  hasNativeOcclusion = false,
  minColumnWidth,
  columnGap,
  hasSecondary,
}: AdaptiveColumnsInput): AdaptiveColumnsPlan {
  const fallbackWidth = Math.max(
    0,
    nonNegative(windowWidth) -
      // Viewport edges may already include the system safe edge, so reserve the larger once.
      Math.max(
        nonNegative(systemInsets.left),
        nonNegative(viewportInsets.left),
      ) -
      Math.max(
        nonNegative(systemInsets.right),
        nonNegative(viewportInsets.right),
      ),
  );
  const hasMeasuredBounds =
    measuredBounds !== null &&
    measuredBounds !== undefined &&
    Number.isFinite(measuredBounds.x) &&
    Number.isFinite(measuredBounds.width) &&
    measuredBounds.width > 0;
  const contentWidth = hasMeasuredBounds ? measuredBounds.width : fallbackWidth;
  const scale =
    Number.isFinite(fontScale) && fontScale > 0 ? Math.max(1, fontScale) : 1;
  const minimumWidth =
    positive(minColumnWidth, NAVIGATION_MINIMUM_COLUMN_WIDTH) * scale;
  const requestedGap = positive(columnGap, ADAPTIVE_COLUMN_GAP);
  // Native regions use window coordinates, so clip them to the measured host before translating offsets.
  const regionOriginX = hasMeasuredBounds
    ? measuredBounds.x
    : (safeAreaFrame?.x ?? nonNegative(systemInsets.left));
  const regionEndX = regionOriginX + contentWidth;
  const regions = validRegions(usableRegions)
    .map(region => {
      const x = Math.max(region.x, regionOriginX);
      const right = Math.min(region.x + region.width, regionEndX);
      return { ...region, x, width: Math.max(0, right - x) };
    })
    .filter(region => region.width > 0)
    .sort((first, second) => first.x - second.x || first.y - second.y);
  const referenceHeight =
    safeAreaFrame && Number.isFinite(safeAreaFrame.height)
      ? safeAreaFrame.height
      : Math.max(0, ...regions.map(region => region.height));
  const fullHeightRegions = regions.filter(
    region => region.height >= referenceHeight * FULL_HEIGHT_REGION_RATIO,
  );
  const singleColumnRegions =
    fullHeightRegions.length > 0 ? fullHeightRegions : regions;
  const selectedRegion = singleColumnRegions
    .slice()
    .sort(
      (first, second) => second.width - first.width || first.x - second.x,
    )[0];
  const singleWidth = selectedRegion
    ? Math.min(contentWidth, selectedRegion.width)
    : contentWidth;
  const leadingInset = selectedRegion
    ? Math.max(0, selectedRegion.x - regionOriginX)
    : 0;

  if (!hasSecondary) {
    // A single-panel route still stays inside one native region instead of spanning a seam.
    return {
      columns: 1,
      contentWidth,
      leadingInset,
      primaryWidth: singleWidth,
      secondaryWidth: 0,
      columnGap: 0,
      rowGap: 0,
    };
  }

  if (hasNativeDivision) {
    let bestPair:
      | {
          readonly leadingInset: number;
          readonly primaryWidth: number;
          readonly secondaryWidth: number;
          readonly columnGap: number;
          readonly score: number;
        }
      | undefined;

    for (let index = 0; index + 1 < fullHeightRegions.length; index += 1) {
      const left = fullHeightRegions[index];
      const right = fullHeightRegions[index + 1];
      if (!left || !right) continue;
      const physicalGap = right.x - (left.x + left.width);
      const verticalOverlap =
        Math.min(left.y + left.height, right.y + right.height) -
        Math.max(left.y, right.y);
      if (
        physicalGap < -1 ||
        verticalOverlap < referenceHeight * FULL_HEIGHT_REGION_RATIO
      ) {
        continue;
      }

      // Preserve a wider native seam; split any extra requested gap across both panels.
      const gap = Math.max(requestedGap, Math.max(0, physicalGap));
      const widthReduction = (gap - Math.max(0, physicalGap)) / 2;
      const primaryWidth = left.width - widthReduction;
      const secondaryWidth = right.width - widthReduction;
      if (primaryWidth < minimumWidth || secondaryWidth < minimumWidth) {
        continue;
      }

      const score = Math.min(primaryWidth, secondaryWidth);
      if (!bestPair || score > bestPair.score) {
        bestPair = {
          leadingInset: Math.max(0, left.x - regionOriginX),
          primaryWidth,
          secondaryWidth,
          columnGap: gap,
          score,
        };
      }
    }

    if (bestPair) {
      return {
        columns: 2,
        contentWidth,
        leadingInset: bestPair.leadingInset,
        primaryWidth: bestPair.primaryWidth,
        secondaryWidth: bestPair.secondaryWidth,
        columnGap: bestPair.columnGap,
        rowGap: requestedGap,
      };
    }
  }

  const hasNativeRegions = validRegions(usableRegions).length > 0;
  const oneUninterruptedRegion =
    !hasNativeDivision &&
    !hasNativeOcclusion &&
    fullHeightRegions.length === 1 &&
    singleWidth >= contentWidth - 0.5 &&
    leadingInset <= 0.5;
  if (
    !hasNativeDivision &&
    !hasNativeOcclusion &&
    (!hasNativeRegions || oneUninterruptedRegion) &&
    contentWidth >= minimumWidth * 2 + requestedGap
  ) {
    const panelWidth = (contentWidth - requestedGap) / 2;
    return {
      columns: 2,
      contentWidth,
      leadingInset: 0,
      primaryWidth: panelWidth,
      secondaryWidth: panelWidth,
      columnGap: requestedGap,
      rowGap: requestedGap,
    };
  }

  return {
    columns: 1,
    contentWidth,
    leadingInset,
    primaryWidth: singleWidth,
    secondaryWidth: singleWidth,
    columnGap: 0,
    rowGap: requestedGap,
  };
}
