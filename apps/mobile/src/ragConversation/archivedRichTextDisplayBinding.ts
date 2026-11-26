import type { ConversationA2UINode } from './conversationA2UI';

type Binding = Readonly<{
  lease: { id: string; version: number };
  revision: {
    current(): boolean;
    watch(retire: () => void): (() => void) | undefined;
  };
}>;
const mounted = new WeakMap<ConversationA2UINode, Binding>();
export const archivedRichTextDisplayBinding = (root: ConversationA2UINode) =>
  mounted.get(root);
export function bindArchivedRichText(
  root: ConversationA2UINode,
  binding: Binding,
) {
  mounted.set(root, binding);
}
