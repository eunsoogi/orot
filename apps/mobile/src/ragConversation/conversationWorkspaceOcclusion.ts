import type { NavigationOcclusion } from '../navigation/navigationLayout';
import { ROOT_TAB_SAFE_AREA_TRANSLATION } from '../navigation/navigationLayout';

/** The native workspace already excludes unsafe bottom points from its frame.
 * Deduct only that measured exclusion from composer clearance, retaining any
 * navigation overlap that still reaches into the workspace. Keyboard-contracted
 * hosts have no such exclusion and must keep their current clearance unchanged.
 */
export function conversationWorkspaceOcclusion(
  occlusion: NavigationOcclusion,
  hostHeight: number,
  frame: { top: number; height: number },
  homeAreaOverlap = 0,
): NavigationOcclusion {
  const consumedBottom = Math.max(0, hostHeight - frame.top - frame.height);
  // Match root-tab positioning only within an observed home-area overlap.
  // A keyboard or a physical bottom occlusion leaves no overlap to reclaim.
  const remainingClearance = Math.max(
    0,
    occlusion.scrollContentInsets.bottom - consumedBottom,
  );
  const reclaimedBottom =
    occlusion.placement === 'right' && remainingClearance <= homeAreaOverlap
      ? Math.min(ROOT_TAB_SAFE_AREA_TRANSLATION, Math.max(0, homeAreaOverlap))
      : 0;
  return {
    ...occlusion,
    scrollContentInsets: {
      ...occlusion.scrollContentInsets,
      bottom: Math.max(0, remainingClearance - reclaimedBottom),
    },
  };
}
