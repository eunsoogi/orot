import type { ConversationA2UINode } from './conversationA2UI';
import { conversationA2UIAppNotices } from './conversationA2UIAppNotices';
import { conversationA2UIModalFor } from './conversationA2UIModalWire';
import { conversationA2UILocalDraftFor } from './conversationA2UILocalDraftFrames';
import type { conversationA2UIIcons } from './conversationA2UIStaticCatalog';
import { isIcon } from './conversationA2UIArchiveShape';
import { conversationA2UIProse } from './conversationA2UIPresentation';
import {
  conversationA2UIRichText,
  conversationRichArchiveProse,
  markVerifiedRichText,
  ownsLiveRichText,
} from './conversationA2UIRichText';
import { isObject } from './taskHistory';

type Container = 'Row' | 'Column' | 'List' | 'Card' | 'Tabs';
type RichShape =
  | 0
  | 1
  | readonly [Container, ...RichShape[]]
  | readonly ['Icon', keyof typeof conversationA2UIIcons]
  | readonly ['Divider', 'horizontal' | 'vertical'];

export type ArchivedConversationRichTextLayout = Readonly<{
  version: 9;
  tree: RichShape;
}>;

const restoredRoots = new WeakSet<ConversationA2UINode>();
export const isRestoredRichText = (root: ConversationA2UINode) =>
  restoredRoots.has(root);

const flow = new Set(['Row', 'Column', 'List', 'Card', 'Tabs']);
const maxDepth = 10;
const maxNodes = 64;

export function storeArchivedConversationRichText(
  root: ConversationA2UINode,
  answer: string,
): ArchivedConversationRichTextLayout | undefined {
  if (!ownsLiveRichText(root) || conversationA2UILocalDraftFor(root)) return;
  const lines = conversationRichArchiveProse(answer);
  const notices = conversationA2UIAppNotices(root, answer);
  if (!lines || !notices || notices.length >= 16) return;
  let at = 0;
  // The v9 archive decoder's shape and size limits include the host-only
  // wrapper. Keep the validated model subtree immutable.
  let count = notices.length ? 1 : 0;
  function shape(
    node: ConversationA2UINode,
    depth: number,
  ): RichShape | undefined {
    if (
      ++count > maxNodes ||
      depth > maxDepth ||
      conversationA2UIModalFor(node)
    )
      return;
    switch (node.component) {
      case 'Text':
        if (
          node.variant !== 'body' ||
          node.weight !== undefined ||
          node.text !== lines![at++]
        )
          return;
        return conversationA2UIRichText(node) ? 1 : 0;
      case 'Icon':
        // A live renderer icon is not necessarily part of the v9 archive catalog.
        return isIcon(node.name) ? ['Icon', node.name] : undefined;
      case 'Divider':
        return ['Divider', node.axis];
      case 'Tabs': {
        const children = node.tabs.map(tab => {
          if (tab.title !== lines![at++] || !conversationA2UIProse(tab.title))
            return;
          return shape(tab.child, depth + 1);
        });
        if (children.every(child => child !== undefined))
          return ['Tabs', ...children];
        return;
      }
      default: {
        if (node.alignment || node.direction) return;
        const children = node.children.map(child => shape(child, depth + 1));
        if (children.every(child => child !== undefined))
          return [node.component, ...children];
      }
    }
  }
  const tree = shape(root, notices.length ? 2 : 1);
  if (tree === undefined) return;
  if (!notices.length) {
    if (at === lines.length) return { version: 9, tree };
    return;
  }
  // Notices are app finalizer copy, bound by exact root and entire body above.
  // Persist only ordinary unformatted v9 slots after the unchanged tree.
  if (
    count + notices.length > maxNodes ||
    !notices.every(
      notice => notice === lines[at++] && conversationA2UIProse(notice),
    ) ||
    at !== lines.length
  )
    return;
  return {
    version: 9,
    tree: ['Column', tree, ...notices.map(() => 0 as const)],
  };
}

/** A separate local shape parser, never a provider frame or legacy parse mode.
 * All content comes from the exact already-accepted answer in the same row. */
export function restoreArchivedConversationRichText(
  value: unknown,
  answer: string,
) {
  if (
    !isObject(value) ||
    value.version !== 9 ||
    !Object.hasOwn(value, 'tree') ||
    Object.keys(value).length !== 2
  )
    return;
  const lines = conversationRichArchiveProse(answer);
  if (!lines) return;
  let at = 0;
  let count = 0;
  const leafModes: [ConversationA2UINode, boolean][] = [];
  function inflate(
    raw: unknown,
    depth: number,
  ): ConversationA2UINode | undefined {
    if (++count > maxNodes || depth > maxDepth) return;
    const id = `archived-rich-${count}`;
    if (raw === 0 || raw === 1) {
      const text = lines![at++];
      if (!text) return;
      const node = { id, component: 'Text', variant: 'body', text } as const;
      leafModes.push([node, raw === 1]);
      return node;
    }
    if (!Array.isArray(raw) || typeof raw[0] !== 'string') return;
    const [component, ...items] = raw;
    if (component === 'Icon') {
      const [name] = items;
      return items.length === 1 && isIcon(name)
        ? { id, component, name }
        : undefined;
    }
    if (component === 'Divider') {
      const [axis] = items;
      if (items.length === 1 && (axis === 'horizontal' || axis === 'vertical'))
        return { id, component, axis };
      return;
    }
    if (
      !flow.has(component) ||
      !items.length ||
      items.length > (component === 'Card' ? 1 : component === 'Tabs' ? 8 : 16)
    )
      return;
    if (component === 'Tabs') {
      const tabs = items.map(item => {
        const title = lines![at++];
        if (!title || !conversationA2UIProse(title)) return;
        const child = inflate(item, depth + 1);
        if (child) return { title, child };
      });
      if (tabs.every(tab => tab !== undefined)) return { id, component, tabs };
      return;
    }
    const children = items.map(item => inflate(item, depth + 1));
    if (children.every(child => child !== undefined))
      return {
        id,
        component: component as Exclude<Container, 'Tabs'>,
        children,
      };
  }
  const root = inflate(value.tree, 1);
  if (
    !root ||
    at !== lines.length ||
    !markVerifiedRichText(root) ||
    leafModes.some(
      ([node, marked]) => Boolean(conversationA2UIRichText(node)) !== marked,
    )
  )
    return;
  restoredRoots.add(root);
  return root;
}
