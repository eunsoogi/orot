import type { NavigationContentFrame } from '../navigation/navigationContentFrame';
import {
  navigationSystemTopBarBottom,
  type NavigationGeometrySnapshot,
} from '../navigation/navigationGeometry';
import type { DisplayMessage } from './ConversationMessage';
import { assistantProfileMaximumWidth } from '../assistantAppearance/assistantProfileGeometry';

const TOP_PROFILE_VISUAL_LIFT = 12;
const TOP_PROFILE_INDICATOR_GAP = 4;

/** Reclaim only clear space above the Conversation profile, not its touch frame. */
export function conversationProfileVisualLift(
  geometry: NavigationGeometrySnapshot | null,
  frame: NavigationContentFrame | null,
  lane: { x: number; y: number; width: number },
): number {
  if (
    !frame?.systemIndicatorAtTop ||
    frame.windowFrame !== geometry?.windowBounds
  )
    return 0;
  const systemBottom = navigationSystemTopBarBottom(geometry);
  if (
    systemBottom === null ||
    frame.availableContentFrame.height <= 0 ||
    ![lane.x, lane.y, lane.width].every(Number.isFinite) ||
    lane.width < 44
  )
    return 0;

  // A workspace measurement can lag the window. Reclaim only the clear band
  // above the current safe-content origin, never a contracted viewport's edge.
  const safeTop = Math.min(lane.y, frame.availableContentFrame.y);
  const lift = Math.min(
    TOP_PROFILE_VISUAL_LIFT,
    safeTop -
      Math.max(frame.viewportFrame.y, systemBottom + TOP_PROFILE_INDICATOR_GAP),
  );
  if (lift <= 0) return 0;

  const exposedTop = safeTop - lift;
  // This centered artwork is narrower than the entire workspace pane. A
  // disjoint edge reservation cannot cover it or move its original hit target.
  const width = Math.min(lane.width, assistantProfileMaximumWidth);
  const left = lane.x + (lane.width - width) / 2;
  return frame.reservedRegions.some(
    ({ isActive, frame: region, margins }) =>
      isActive &&
      region.x - margins.left < left + width &&
      region.x + region.width + margins.right > left &&
      region.y - margins.top < lane.y &&
      region.y + region.height + margins.bottom > exposedTop,
  )
    ? 0
    : lift;
}

/** Native hinge capability and measured safe host width are both required. */
export function conversationWorkspaceLayout(
  hasHinge: boolean,
  width: number,
  fontScale: number,
) {
  const scale = Number.isFinite(fontScale) ? Math.max(1, fontScale) : 1;
  const visible = hasHinge && Number.isFinite(width) && width >= 760 * scale;
  return {
    visible,
    activityWidth: visible ? Math.max(260 * scale, width * 0.32) : 0,
  };
}

/** Hidden tool-only pending turns must not leave empty answer cards behind. */
export function transcriptMessageVisible(
  message: DisplayMessage,
  separated: boolean,
) {
  return (
    !message.streaming ||
    Boolean(message.initialResponse?.text.trim()) ||
    (!separated && Boolean(message.content.trim()))
  );
}
