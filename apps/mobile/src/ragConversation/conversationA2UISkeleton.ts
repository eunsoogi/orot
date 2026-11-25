import type { ConversationLayoutSkeleton } from '@orot/agent-runtime';
import {
  applyConversationA2UIFrame,
  conversationA2UIFrameLimit,
  type ConversationA2UINode,
  type ConversationA2UIState,
} from './conversationA2UI';
import { draftA2UISurfaceId } from './conversationA2UIPresentation';
import { completeConversationSkeletonFrames } from './conversationA2UIStreamFrames';

function container(node: ConversationA2UINode): ConversationA2UINode {
  return node.component === 'Card' && node.children.length === 1
    ? node.children[0]!
    : node;
}

/** Only geometry escapes; frame state, ids, prose and bindings do not. */
export function projectConversationA2UISkeleton(
  raw: string,
): ConversationLayoutSkeleton | undefined {
  const frames = completeConversationSkeletonFrames(raw);
  if (!frames?.length) return undefined;
  let surface: ConversationA2UIState | null = null;
  let used = 0;
  for (const frame of frames) {
    used += frame.length;
    if (
      frame.length > conversationA2UIFrameLimit ||
      used > 2 * conversationA2UIFrameLimit
    )
      return undefined;
    const next = applyConversationA2UIFrame(surface, frame, draftA2UISurfaceId);
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
