import {
  conversationA2UIFrameLimit,
  type ConversationA2UINode,
} from './conversationA2UI';

type Column = Extract<
  ConversationA2UINode,
  { component: 'Card' | 'Column' | 'Row' | 'List' }
>;
const liveModals = new WeakSet<ConversationA2UINode>();

export const conversationA2UIModalFor = (node: ConversationA2UINode) =>
  liveModals.has(node) && node.component === 'Column'
    ? (node as Column)
    : undefined;

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
type Lowered =
  | { status: 'none' }
  | { status: 'invalid' }
  | {
      status: 'lowered';
      frames: string[];
      id: string;
      trigger: string;
      content: string;
    };

/** One final static Modal uses the existing graph and prose validator. No
 * renderer metadata survives a wire update, JSON copy, or owned archive. */
export function lowerConversationA2UIModal(value: unknown): Lowered {
  if (!Array.isArray(value)) return { status: 'none' };
  if (
    value.length !== 1 ||
    typeof value[0] !== 'string' ||
    value[0].length > conversationA2UIFrameLimit
  )
    return { status: 'none' }; // Older validator still rejects Modal in all multi-frame inputs.
  let frame: unknown;
  try {
    frame = JSON.parse(value[0]);
  } catch {
    return { status: 'none' };
  }
  if (
    !record(frame) ||
    !record(frame.createSurface) ||
    !Array.isArray(frame.createSurface.components)
  )
    return { status: 'none' };
  const { components } = frame.createSurface;
  const modals = components.filter(
    node => record(node) && node.component === 'Modal',
  );
  if (!modals.length) return { status: 'none' };
  const modal = modals[0];
  if (
    modals.length !== 1 ||
    !record(modal) ||
    Object.keys(modal).length !== 4 ||
    typeof modal.id !== 'string' ||
    typeof modal.trigger !== 'string' ||
    typeof modal.content !== 'string' ||
    modal.trigger === modal.content ||
    modal.id === modal.trigger ||
    modal.id === modal.content ||
    !components.some(
      node =>
        record(node) && node.id === modal.trigger && node.component === 'Text',
    )
  )
    return { status: 'invalid' };
  const { id, trigger, content } = modal;
  const lowered = JSON.stringify({
    ...frame,
    createSurface: {
      ...frame.createSurface,
      components: components.map(node =>
        node === modal
          ? { id, component: 'Column', children: [trigger, content] }
          : node,
      ),
    },
  });
  return { status: 'lowered', frames: [lowered], id, trigger, content };
}

export function bindConversationA2UIModal(
  root: ConversationA2UINode,
  input: Extract<Lowered, { status: 'lowered' }>,
): boolean {
  const visit = (node: ConversationA2UINode): boolean => {
    if (node.id === input.id) {
      if (
        node.component !== 'Column' ||
        node.children.length !== 2 ||
        node.children[0].component !== 'Text' ||
        node.children[0].id !== input.trigger ||
        node.children[1].id !== input.content
      )
        return false;
      liveModals.add(node);
      return true;
    }
    return node.component === 'Tabs'
      ? node.tabs.some(tab => visit(tab.child))
      : 'children' in node && node.children.some(visit);
  };
  return visit(root);
}
