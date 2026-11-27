import type { ConversationA2UINode } from './conversationA2UI';
import { conversationA2UIFrameLimit } from './conversationA2UIWire';
import { isObject } from './taskHistory';

const admittedFolders = new WeakSet<object>();

/** Omit only decorations minted by the validated current final responder. */
export function isAdmittedConversationA2UIFolder(node: unknown): boolean {
  return node !== null && typeof node === 'object' && admittedFolders.has(node);
}

/** Lower one known literal to the existing inert icon for graph validation.
 * Restore the native name only when its exact reachable slot directly
 * precedes accepted text in the same Row or Column. */
export function acceptConversationA2UIFolder(
  raw: unknown,
  validateLowered: (frames: unknown) => ConversationA2UINode | undefined,
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
    let folderId: string | undefined;
    const components = (surface.components as unknown[]).map(node => {
      if (
        !isObject(node) ||
        node.component !== 'Icon' ||
        node.name !== 'folder'
      )
        return node;
      if (folderId !== undefined || typeof node.id !== 'string')
        throw new Error('Unsupported folder icon.');
      folderId = node.id;
      // Forward all other fields to the unchanged whitelist validator.
      return { ...node, name: 'info' };
    });
    if (folderId === undefined) return;
    const root = validateLowered([
      JSON.stringify({
        ...message,
        createSurface: { ...surface, components },
      }),
    ]);
    if (!root) return;

    let promoted = false;
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
            child.id === folderId &&
            child.component === 'Icon'
          ) {
            const next = node.children[index + 1];
            if (next?.component === 'Text' && next.variant === 'body') {
              const folder: ConversationA2UINode = { ...child, name: 'folder' };
              admittedFolders.add(folder);
              promoted = true;
              return folder;
            }
          }
          return visit(child);
        }),
      };
    }
    const decorated = visit(root);
    return promoted ? decorated : undefined;
  } catch {
    // The optional layout is untrusted; the original answer stays readable.
    return undefined;
  }
}
