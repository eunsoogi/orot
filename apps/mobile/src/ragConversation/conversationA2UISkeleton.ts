import type { ConversationLayoutSkeleton } from '@orot/agent-runtime';
import {
  applyConversationA2UIFrame,
  conversationA2UIFrameLimit,
  type ConversationA2UINode,
  type ConversationA2UIState,
} from './conversationA2UI';
import { draftA2UISurfaceId } from './conversationA2UIPresentation';
import { lowerConversationRepeatedChildren } from './conversationA2UIRepeatedChildren';
import { completeConversationSkeletonFrames } from './conversationA2UIStreamFrames';

function container(node: ConversationA2UINode): ConversationA2UINode {
  return node.component === 'Card' && node.children.length === 1
    ? node.children[0]!
    : node;
}

/** Only geometry escapes; frame state, ids, prose and bindings do not. */
export function projectConversationA2UISkeleton(
  raw: string,
  allowRepeatedChildren = false,
  allowStructuralRetirement = false,
): ConversationLayoutSkeleton | undefined {
  const streamed = completeConversationSkeletonFrames(raw);
  if (
    !streamed?.length ||
    streamed.some(frame => frame.length > conversationA2UIFrameLimit) ||
    streamed.reduce((used, frame) => used + frame.length, 0) >
      2 * conversationA2UIFrameLimit
  )
    return undefined;
  // Materialization here is scratch-only: the returned hint contains only
  // neutral geometry. The terminal validator owns all visible answer text.
  const frames = allowRepeatedChildren
    ? (lowerConversationRepeatedChildren(streamed) ?? streamed)
    : streamed;
  let surface: ConversationA2UIState | null = null;
  let used = 0;
  for (const frame of frames) {
    used += frame.length;
    if (
      frame.length > conversationA2UIFrameLimit ||
      used > 2 * conversationA2UIFrameLimit
    )
      return undefined;
    const next = applyConversationA2UIFrame(
      surface,
      frame,
      draftA2UISurfaceId,
      false,
      false,
      false,
      false,
      allowStructuralRetirement,
    );
    if (!next || next === surface || next.status === 'invalid')
      return undefined;
    surface = next;
  }
  if (!surface?.root) return undefined;
  const layout = container(surface.root);
  if (!('children' in layout) || !layout.children.length) return undefined;
  const length = layout.children.length;
  return {
    kind: layout.component === 'Row' && length === 2 ? 'row' : 'stack',
    slots: length === 1 ? 1 : length === 2 ? 2 : 3,
  };
}
