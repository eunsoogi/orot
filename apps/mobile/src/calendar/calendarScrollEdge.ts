import type { NavigationContentFrame } from '../navigation/navigationContentFrame';

/** Move only the shell-owned bottom edge from a clipping boundary into scroll-end clearance. */
export function calendarScrollEdge(
  frame: NavigationContentFrame | null,
  enabled: boolean,
) {
  if (!enabled || !frame) return 0;
  const viewportBottom = frame.viewportFrame.y + frame.viewportFrame.height;
  const contentBottom =
    frame.availableContentFrame.y + frame.availableContentFrame.height;
  // A keyboard-contracted viewport already ends above the system edge, so it contributes zero.
  return Math.max(0, viewportBottom - contentBottom);
}
