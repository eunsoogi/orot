import type { NavigationGeometryRect as Rect } from '../../navigation/navigationGeometry';

type Point = { x: number; y: number };

export function chartRectValid(rect: Rect): boolean {
  return (
    [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

export function chartRectContains(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

export function intersectChartRects(a: Rect, b: Rect): Rect | undefined {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;
  const rect = { x, y, width, height };
  return chartRectValid(rect) ? rect : undefined;
}

/** Resolve one same-pane intersection inside the actual visible route. */
export function visibleChartTooltipPane(
  route: Rect,
  host: Rect,
  anchor: Point,
  nativePanes: readonly Rect[] | undefined,
  bottomBarTop: number | undefined,
  bottomClearance: number,
) {
  const bottom = route.y + route.height;
  const end =
    bottomBarTop === undefined
      ? bottom - bottomClearance
      : Math.min(bottom, bottomBarTop);
  const visible = { ...route, height: end - route.y };
  const pane = (nativePanes ?? [visible])
    .map(region => intersectChartRects(region, visible))
    .find(region => region && chartRectContains(region, anchor));
  return pane && intersectChartRects(pane, host);
}

/** Never overlap the plot or jump to a pane that doesn't contain this point. */
export function placeChartTooltip(
  pane: Rect,
  plot: Rect,
  anchor: Point,
  width: number,
  height: number,
): Point | undefined {
  const gap = 8;
  if (
    !chartRectValid(pane) ||
    !chartRectValid(plot) ||
    !chartRectContains(pane, anchor) ||
    !chartRectContains(plot, anchor) ||
    ![width, height].every(value => Number.isFinite(value) && value > 0)
  )
    return undefined;

  const left = pane.x + gap;
  const right = pane.x + pane.width - gap;
  const top = pane.y + gap;
  const bottom = pane.y + pane.height - gap;
  if (width > right - left || height > bottom - top) return undefined;
  const x = Math.max(left, Math.min(right - width, anchor.x - width / 2));
  const above = plot.y - gap - height;
  if (above >= top) return { x, y: above };
  const below = plot.y + plot.height + gap;
  if (below + height <= bottom) return { x, y: below };
  const y = Math.max(top, Math.min(bottom - height, anchor.y - height / 2));
  const before = plot.x - gap - width;
  if (before >= left) return { x: before, y };
  const after = plot.x + plot.width + gap;
  if (after + width <= right) return { x: after, y };
  return undefined;
}
export function stableChartTooltipRect(a: Rect, b: Rect) {
  return (
    Math.abs(a.x - b.x) <= 1 &&
    Math.abs(a.y - b.y) <= 1 &&
    Math.abs(a.width - b.width) <= 1 &&
    Math.abs(a.height - b.height) <= 1
  );
}
