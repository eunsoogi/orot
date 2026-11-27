import type { ConversationA2UINode } from './conversationA2UI';
import { conversationA2UIFrameLimit } from './conversationA2UIWire';
import { localA2UIDraftResetAction } from './conversationA2UILocalDraft';
import {
  conversationA2UIComposedControl,
  hasConversationA2UIComposedControls,
} from './conversationA2UIComposedControlState';
import { id, keys, object } from './conversationA2UIWireValues';
import { conversationA2UIFrameProse } from './conversationA2UIPresentation';

const labels = new WeakMap<ConversationA2UINode, string>();
export const conversationA2UIComposedResetLabel = (
  node: ConversationA2UINode,
) => labels.get(node);

/** The Button is lowered without removing its exact Text child, so it cannot
 * bypass the ordinary validator's graph, ownership or accepted prose checks. */
export function projectConversationA2UIComposedReset(raw: unknown) {
  if (
    !Array.isArray(raw) ||
    raw.length !== 1 ||
    typeof raw[0] !== 'string' ||
    raw[0].length > conversationA2UIFrameLimit
  )
    return;
  try {
    const message = object(JSON.parse(raw[0]) as unknown);
    const surface = object(message.createSurface);
    if (
      !Array.isArray(surface.components) ||
      Object.hasOwn(surface, 'dataModel')
    )
      return;
    let reset: { buttonId: string; labelId: string } | undefined;
    const components = surface.components.map((rawNode: unknown) => {
      const node = object(rawNode);
      if (node.component !== 'Button') return node;
      keys(node, ['id', 'component', 'child', 'action']);
      const action = object(node.action);
      keys(action, ['event']);
      const event = object(action.event);
      keys(event, ['name', 'context']);
      keys(object(event.context), []);
      if (reset || event.name !== localA2UIDraftResetAction)
        throw new Error('Unsupported local reset.');
      reset = { buttonId: id(node.id), labelId: id(node.child) };
      return {
        id: reset.buttonId,
        component: 'Column',
        children: [reset.labelId],
      };
    });
    if (!reset) return;
    const labelNode = surface.components
      .map(object)
      .find(node => node.id === reset?.labelId);
    if (!labelNode || labelNode.component !== 'Text') return;
    const label = labelNode.text;
    if (
      typeof label !== 'string' ||
      label.length > 96 ||
      conversationA2UIFrameProse(label)?.length !== 1 ||
      /[<>\p{Cc}\p{Cf}]|(?:https?:|www\.)/iu.test(label)
    )
      return;
    return {
      ...reset,
      label,
      frames: [
        JSON.stringify({
          ...message,
          createSurface: { ...surface, components },
        }),
      ],
    };
  } catch {
    // An unsupported Button leaves the entire optional surface as plain prose.
  }
}

/** Bind the reset only to the reachable validated node and the same mounted
 * reviewed form. No wire event or context leaves the runtime. */
export function bindConversationA2UIComposedReset(
  root: ConversationA2UINode,
  projected: NonNullable<
    ReturnType<typeof projectConversationA2UIComposedReset>
  >,
) {
  if (!hasConversationA2UIComposedControls(root)) return false;
  let target: ConversationA2UINode | undefined;
  function visit(node: ConversationA2UINode) {
    if (
      node.id === projected.buttonId &&
      node.component === 'Column' &&
      node.children.length === 1 &&
      node.children[0]?.component === 'Text' &&
      node.children[0].id === projected.labelId &&
      node.children[0].text === projected.label &&
      !conversationA2UIComposedControl(node)
    )
      target = node;
    if (node.component === 'Tabs') node.tabs.forEach(tab => visit(tab.child));
    else if ('children' in node) node.children.forEach(visit);
  }
  visit(root);
  if (!target) return false;
  labels.set(target, projected.label);
  return true;
}
