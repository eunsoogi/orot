import type { ConversationA2UINode } from './conversationA2UI';
import { conversationA2UIFrameLimit } from './conversationA2UIWire';
import { isObject } from './taskHistory';

const admittedFolders = new WeakSet<object>();

/** Omit only decorations minted by the validated current final responder. */
export function isAdmittedConversationA2UIFolder(node: unknown): boolean {
  return node !== null && typeof node === 'object' && admittedFolders.has(node);
}

/** Lower the bounded known literal to the existing inert icon for graph validation.
 * Restore the native name only when its exact reachable slot directly
 * precedes accepted text in the same Row or Column. */
export function acceptConversationA2UIFolder(
  raw: unknown,
  validateLowered: (frames: unknown) => ConversationA2UINode | undefined,
  limit: 1 | 3 = 1,
): ConversationA2UINode | undefined {
  if (!Array.isArray(raw) || raw.length !== 1) return;
  const wire: unknown = raw[0];
  if (typeof wire !== 'string' || wire.length > conversationA2UIFrameLimit)
    return;

  try {
    const message: unknown = JSON.parse(wire);
    if (!isObject(message) || !isObject(message.createSurface)) return;
    const surface = message.createSurface;
    if (
      !Array.isArray(surface.components) ||
      Object.hasOwn(surface, 'dataModel')
    )
      return;
    const folderIds = new Set<string>();
    const components = (surface.components as unknown[]).map(node => {
      if (
        !isObject(node) ||
        node.component !== 'Icon' ||
        node.name !== 'folder'
      )
        return node;
      if (
        typeof node.id !== 'string' ||
        folderIds.size >= limit ||
        folderIds.has(node.id)
      )
        throw new Error('Unsupported folder icon.');
      folderIds.add(node.id);
      // Forward all other fields to the unchanged whitelist validator.
      return { ...node, name: 'info' };
    });
    if (!folderIds.size) return;
    const root = validateLowered([
      JSON.stringify({
        ...message,
        createSurface: { ...surface, components },
      }),
    ]);
    if (!root) return;

    const promoted = new Set<string>();
    function visit(node: ConversationA2UINode): ConversationA2UINode {
      if (node.component === 'Tabs')
        return {
          ...node,
          tabs: node.tabs.map(tab => ({ ...tab, child: visit(tab.child) })),
        };
      if (!('children' in node)) return node;
      return {
        ...node,
        children: node.children.map((child, index) => {
          if (
            (node.component === 'Row' || node.component === 'Column') &&
            folderIds.has(child.id) &&
            child.component === 'Icon'
          ) {
            const next = node.children[index + 1];
            if (next?.component === 'Text' && next.variant === 'body') {
              const folder: ConversationA2UINode = { ...child, name: 'folder' };
              admittedFolders.add(folder);
              promoted.add(child.id);
              return folder;
            }
          }
          return visit(child);
        }),
      };
    }
    const decorated = visit(root);
    return promoted.size === folderIds.size ? decorated : undefined;
  } catch {
    // The optional layout is untrusted; the original answer stays readable.
    return undefined;
  }
}
