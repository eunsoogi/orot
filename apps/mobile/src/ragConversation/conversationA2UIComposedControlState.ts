import type { ConversationA2UINode } from './conversationA2UI';

export type ComposedControl = Readonly<
  | { kind: 'check'; label: string }
  | {
      kind: 'text';
      label: string;
      placeholder?: string;
      multiline?: true;
      numeric?: true;
    }
  | { kind: 'time'; label: string }
  | { kind: 'date'; label: string; min: string; max: string }
  | { kind: 'slider'; label: string; min: number; max: number; steps: number }
  | {
      kind: 'choice';
      label: string;
      multiple: boolean;
      filterable?: true;
      options: readonly Readonly<{ label: string; value: string }>[];
    }
>;

const fields = new WeakMap<ConversationA2UINode, ComposedControl>();
const liveForms = new WeakSet<ConversationA2UINode>();

/** Bind only the exact reachable placeholders taken from the validated final tree. */
export function bindConversationA2UIComposedControls(
  root: ConversationA2UINode,
  controls: ReadonlyMap<string, ComposedControl>,
) {
  const matches = new Map<ConversationA2UINode, ComposedControl>();
  function walk(node: ConversationA2UINode) {
    const control = controls.get(node.id);
    if (control && node.component === 'Divider') matches.set(node, control);
    if (node.component === 'Tabs') node.tabs.forEach(tab => walk(tab.child));
    else if ('children' in node) node.children.forEach(walk);
  }
  walk(root);
  if (matches.size !== controls.size) return false;
  for (const [node, control] of matches) fields.set(node, control);
  liveForms.add(root);
  return true;
}

export const conversationA2UIComposedControl = (node: ConversationA2UINode) =>
  fields.get(node);
export const hasConversationA2UIComposedControls = (
  root: ConversationA2UINode,
) => liveForms.has(root);
