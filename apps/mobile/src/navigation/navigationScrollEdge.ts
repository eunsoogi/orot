import {
  useNavigationContentFrame,
  type NavigationContentFrame,
} from './navigationContentFrame';

/** Separates a right rail's visual scroll lane from the content reservation.
 * The window edge must belong to this viewport, not an adjacent split scene. */
export function resolveNavigationRightScrollEdge(
  frame: NavigationContentFrame | null,
): number {
  if (frame?.side !== 'right') return 0;
  const {
    availableContentFrame: content,
    viewportFrame: viewport,
    windowFrame: window,
  } = frame;
  const outer = viewport.x + viewport.width;
  const inner = content.x + content.width;
  const right = outer - inner;
  if (
    ![
      outer,
      inner,
      right,
      content.width,
      viewport.height,
      window.x,
      window.width,
    ].every(Number.isFinite) ||
    viewport.height <= 0 ||
    content.width <= 0 ||
    window.width <= 0 ||
    Math.abs(outer - (window.x + window.width)) > 1 ||
    right <= 0
  ) {
    return 0;
  }
  // Never draw into a physical seam. A top-side system occlusion is handled by
  // the vertical indicator inset, not mistaken for another scroll viewport.
  if (
    frame.reservedRegions.some(
      ({ kind, isActive, frame: region }) =>
        kind === 'division' &&
        isActive &&
        region.x < outer &&
        region.x + region.width > inner &&
        region.y < viewport.y + viewport.height &&
        region.y + region.height > viewport.y,
    )
  ) {
    return 0;
  }
  return right;
}

export function useNavigationRightScrollEdge() {
  const frame = useNavigationContentFrame();
  const right = resolveNavigationRightScrollEdge(frame);
  const contentTop = frame?.availableContentFrame.y ?? 0;
  const top =
    right && frame
      ? Math.max(
          0,
          ...frame.reservedRegions
            .filter(
              ({ kind, isActive, frame: region }) =>
                kind === 'occlusion' &&
                isActive &&
                region.x + region.width >=
                  frame.viewportFrame.x + frame.viewportFrame.width - 4 &&
                region.y <= contentTop + 1,
            )
            .map(({ frame: region }) => region.y + region.height - contentTop),
        )
      : 0;
  return { right, top, contentWidth: frame?.availableContentFrame.width ?? 0 };
}
