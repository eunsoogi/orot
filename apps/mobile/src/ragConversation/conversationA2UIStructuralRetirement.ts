import { fail, type WireNode } from './conversationA2UIWire';

export function childIds(component: WireNode): readonly string[] {
  if (component.component === 'Tabs')
    return component.tabs.map(tab => tab.child);
  return 'children' in component ? component.children : [];
}

const structural = new Set(['Card', 'Column', 'List', 'Row']);

/** Drop only unchanged, previously validated structural wrappers detached
 * by one atomic update. New orphans and displaced content still fail closed. */
export function retireConversationA2UIWrappers(
  current: Map<string, WireNode>,
  updated: readonly WireNode[],
  readyComponents: ReadonlyMap<string, WireNode> | undefined,
  priorRetired: ReadonlySet<string> | undefined,
) {
  if (priorRetired) {
    for (const node of current.values()) {
      if (
        priorRetired.has(node.id) ||
        childIds(node).some(id => priorRetired.has(id))
      )
        fail();
    }
  }
  if (!readyComponents) return priorRetired;
  const reached = new Set<string>();
  const visit = (id: string) => {
    if (reached.has(id)) return;
    reached.add(id);
    const node = current.get(id);
    if (node) childIds(node).forEach(visit);
  };
  visit('root');
  const detached: string[] = [];
  const written = new Set(updated.map(node => node.id));
  for (const [id, node] of current) {
    if (reached.has(id)) continue;
    if (
      readyComponents.get(id) !== node ||
      written.has(id) ||
      !structural.has(node.component)
    )
      // An ordinary staged graph may become complete in a later frame. Do not
      // change that policy or prune any portion of an ineligible update.
      return priorRetired;
    detached.push(id);
  }
  if (!detached.length) return priorRetired;
  const retired = new Set(priorRetired);
  for (const id of detached) {
    retired.add(id);
    current.delete(id);
  }
  return retired;
}
