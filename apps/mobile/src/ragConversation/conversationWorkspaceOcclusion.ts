import type { NavigationOcclusion } from '../navigation/navigationLayout';

/** The native workspace already excludes unsafe bottom points from its frame.
 * Deduct only that measured exclusion from composer clearance, retaining any
 * navigation overlap that still reaches into the workspace. Keyboard-contracted
 * hosts have no such exclusion and must keep their current clearance unchanged.
 */
export function conversationWorkspaceOcclusion(
  occlusion: NavigationOcclusion,
  hostHeight: number,
  frame: { top: number; height: number },
): NavigationOcclusion {
  const consumedBottom = Math.max(0, hostHeight - frame.top - frame.height);
  return {
    ...occlusion,
    scrollContentInsets: {
      ...occlusion.scrollContentInsets,
      bottom: Math.max(
        0,
        occlusion.scrollContentInsets.bottom - consumedBottom,
      ),
    },
  };
}
