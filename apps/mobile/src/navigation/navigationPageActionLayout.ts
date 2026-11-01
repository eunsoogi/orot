import {
  NAVIGATION_CONTEXTUAL_RAIL_CONTROL_HEIGHT,
  NAVIGATION_CONTEXTUAL_RAIL_STACK_SPACING,
  NAVIGATION_ROOT_RAIL_HEIGHT,
} from './navigationRootLayout';

const step =
  NAVIGATION_CONTEXTUAL_RAIL_CONTROL_HEIGHT +
  NAVIGATION_CONTEXTUAL_RAIL_STACK_SPACING;
const groupGap = 8;

/** Allocates one shared keyboard-adjusted segment to both rail groups. */
export function pageActionRailLayout({
  height,
  top,
  bottom,
  rootTabs,
  navigationCount,
  actionCount,
}: {
  height: number;
  top: number;
  bottom: number;
  rootTabs: boolean;
  navigationCount: number;
  actionCount: number;
}) {
  const available = Math.max(0, height - top - bottom);
  const navHeight = rootTabs
    ? NAVIGATION_ROOT_RAIL_HEIGHT
    : navigationCount * step;
  const pageSpace = rootTabs
    ? (available - navHeight) / 2
    : available - navHeight;
  const capacity = Math.max(0, Math.floor((pageSpace - groupGap) / step));
  const displayed = Math.min(actionCount, capacity);
  const fits = available >= navHeight && (actionCount === 0 || displayed > 0);
  const pageBottom = rootTabs
    ? top + (available - navHeight) / 2 - groupGap
    : top + displayed * step;
  return {
    fits,
    capacity,
    pageBottomInset: Math.max(0, height - pageBottom),
    navigationTopInset:
      rootTabs || !displayed ? top : top + displayed * step + groupGap,
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
) {
  const available = surfaceWidth - 32;
  const fits = (values: readonly number[]) =>
    values.reduce((sum, width) => sum + width, 0) + values.length * 12 <=
    available;
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
