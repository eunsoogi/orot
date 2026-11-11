import {
  NAVIGATION_CONTEXTUAL_RAIL_CONTROL_HEIGHT,
  NAVIGATION_CONTEXTUAL_RAIL_STACK_SPACING,
  NAVIGATION_ROOT_BACK_GROUP_HEIGHT,
  NAVIGATION_ROOT_RAIL_HEIGHT,
} from './navigationRootLayout';

const step =
  NAVIGATION_CONTEXTUAL_RAIL_CONTROL_HEIGHT +
  NAVIGATION_CONTEXTUAL_RAIL_STACK_SPACING;
const groupGap = 8;

/** Check the whole bottom row before choosing how to handle insufficient width. */
export function fitsBottomNavigationRow({
  width,
  navigationWidths,
  actionWidths,
  horizontalInsets,
  itemGap,
}: {
  width: number;
  navigationWidths: readonly number[];
  actionWidths: readonly number[];
  horizontalInsets: number;
  itemGap: number;
}): boolean {
  const items = [...navigationWidths, ...actionWidths];
  const dimensions = [width, horizontalInsets, itemGap, ...items];
  if (!dimensions.every(value => Number.isFinite(value) && value >= 0))
    return false;
  const required =
    horizontalInsets +
    items.reduce((total, itemWidth) => total + itemWidth, 0) +
    Math.max(0, items.length - 1) * itemGap;
  return required <= width;
}

/** Allocates one measured segment to the page-action dock and navigation rail. */
export function pageActionRailLayout({
  height,
  top,
  bottom,
  rootTabs,
  navigationCount,
  actionCount,
  hasContextualBack = false,
}: {
  height: number;
  top: number;
  bottom: number;
  rootTabs: boolean;
  navigationCount: number;
  actionCount: number;
  hasContextualBack?: boolean;
}) {
  const available = Math.max(0, height - top - bottom);
  // The fixed root surface stays five tabs tall; shared Back gets its own 48pt target and 4pt gap.
  const navHeight = rootTabs
    ? NAVIGATION_ROOT_RAIL_HEIGHT +
      (hasContextualBack ? NAVIGATION_ROOT_BACK_GROUP_HEIGHT : 0)
    : navigationCount * step;
  const pageSpace = available - navHeight;
  const railGapCount = rootTabs ? 1 : Math.min(navigationCount, 2);
  // UIKit's flexible spacer occupies a stack gap before the first button, so
  // every displayed action needs one control height and one spacing interval.
  const capacity = Math.max(
    0,
    Math.floor((pageSpace - railGapCount * groupGap) / step),
  );
  const displayed = Math.min(actionCount, capacity);
  const fits = available >= navHeight && (actionCount === 0 || displayed > 0);
  const displayedActionHeight = displayed * step;
  // Center the complete action-and-tab group around the measured usable segment.
  const actionGroupHeight =
    displayed > 0 ? displayedActionHeight + groupGap : 0;
  // Keep Back at the lane top and Home at its bottom; page actions use the space between them.
  const pageTopInset =
    !rootTabs && navigationCount > 0 ? top + step + groupGap : top;
  const pageBottom = rootTabs
    ? top + (available - navHeight) / 2 - groupGap + actionGroupHeight / 2
    : pageTopInset + displayed * step;
  return {
    fits,
    capacity,
    pageTopInset,
    pageBottomInset: Math.max(0, height - pageBottom),
    navigationTopInset: rootTabs
      ? top +
        actionGroupHeight +
        (hasContextualBack ? NAVIGATION_ROOT_BACK_GROUP_HEIGHT : 0)
      : top,
  };
}

/** Overflow occupies one slot and preserves the original action order. */
export function splitPageActions<T>(actions: readonly T[], capacity: number) {
  if (actions.length <= capacity) return { visible: actions, overflow: [] };
  const visibleCount = Math.max(0, capacity - 1);
  return {
    visible: actions.slice(0, visibleCount),
    overflow: actions.slice(visibleCount),
  };
}

/** Reserve native toolbar insets and every stack gap before exposing a prefix. */
export function splitMeasuredPageActions<T>(
  actions: readonly T[],
  widths: readonly number[],
  surfaceWidth: number,
  navigationWidths: readonly number[] = [],
  horizontalInsets = 44,
) {
  const fits = (values: readonly number[]) =>
    fitsBottomNavigationRow({
      width: surfaceWidth,
      navigationWidths,
      actionWidths: values,
      // Existing page-only layout reserves one extra stack gap at its edge.
      horizontalInsets,
      itemGap: 12,
    });
  if (
    widths.length !== actions.length + 1 ||
    !widths.every(width => Number.isFinite(width) && width >= 0) ||
    !Number.isFinite(surfaceWidth)
  )
    return { visible: [] as readonly T[], overflow: actions };
  const actionWidths = widths.slice(0, -1);
  if (fits(actionWidths))
    return { visible: actions, overflow: [] as readonly T[] };
  const more = widths[widths.length - 1]!;
  let count = 0;
  while (
    count < actions.length &&
    fits([...actionWidths.slice(0, count + 1), more])
  )
    count += 1;
  return { visible: actions.slice(0, count), overflow: actions.slice(count) };
}
