import type { ConversationA2UINode } from './conversationA2UI';
import type { ComposedControl } from './conversationA2UIComposedControlState';
import {
  conversationA2UIFrameProse,
  matchesConversationA2UIProse,
} from './conversationA2UIPresentation';

/**
 * Opt-in only: each checked-by-the-graph local CheckBox can consume exactly
 * one unchecked fallback item. The comparison tree is never rendered or stored.
 */
export function matchesConversationA2UIChecklist(
  root: ConversationA2UINode,
  answer: string,
  controls: ReadonlyMap<string, ComposedControl>,
): boolean {
  const expected = conversationA2UIFrameProse(answer);
  if (!expected || !controls.size) return false;
  const consumed = new Set<string>();
  let rejected = false;
  function comparison(node: ConversationA2UINode): ConversationA2UINode {
    const control = controls.get(node.id);
    if (control) {
      if (
        node.component !== 'Divider' ||
        control.kind !== 'check' ||
        consumed.has(node.id) ||
        !control.label ||
        control.label.trim() !== control.label ||
        /[\r\n]/u.test(control.label)
      ) {
        rejected = true;
        return node;
      }
      consumed.add(node.id);
      return {
        id: node.id,
        component: 'Text',
        variant: 'body',
        text: '☐ ' + control.label,
      };
    }
    if (node.component === 'Tabs')
      return {
        ...node,
        tabs: node.tabs.map(tab => ({ ...tab, child: comparison(tab.child) })),
      };
    if ('children' in node)
      return { ...node, children: node.children.map(comparison) };
    return node;
  }
  const corroboratingTree = comparison(root);
  return (
    !rejected &&
    consumed.size === controls.size &&
    matchesConversationA2UIProse(corroboratingTree, expected, true)
  );
}
