import type { ConversationA2UINode } from './conversationA2UI';
import {
  conversationA2UICardWeight,
  markConversationA2UICardWeight,
} from './conversationA2UICardWeightTask';
import { isConversationA2UIRowWeight } from './conversationA2UIRowWeight';
import { conversationA2UIModalFor } from './conversationA2UIModalWire';
import { conversationA2UILocalDraftFor } from './conversationA2UILocalDraftFrames';
import {
  restoreConversationA2UILayout,
  storeConversationA2UILayout,
  type ArchivedA2UILayout,
} from './conversationA2UIArchive';
import { keys, record } from './conversationA2UIArchiveShape';

export type ArchivedConversationWeightedCardsLayout = Readonly<{
  version: 10;
  base: ArchivedA2UILayout;
  weights: readonly (readonly [number, number])[];
}>;

const restored = new WeakSet<ConversationA2UINode>();
export const isRestoredWeightedCards = (root: ConversationA2UINode) =>
  restored.has(root);

/** The order below belongs to the admitted layout, not to model IDs. A Card
 * has a weight slot only as a direct Row child. Never capture local actions. */
function cardSlots(root: ConversationA2UINode) {
  if (conversationA2UILocalDraftFor(root)) return;
  const slots: ConversationA2UINode[] = [];
  let visited = 0;
  function walk(
    node: ConversationA2UINode,
    depth: number,
    insideRow: boolean,
  ): boolean {
    if (++visited > 64 || depth > 10 || conversationA2UIModalFor(node))
      return false;
    if (insideRow && node.component === 'Card') slots.push(node);
    return node.component === 'Tabs'
      ? node.tabs.every(tab => walk(tab.child, depth + 1, false))
      : !('children' in node) ||
          node.children.every(child =>
            walk(child, depth + 1, node.component === 'Row'),
          );
  }
  if (walk(root, 1, false)) return slots;
}

export function storeArchivedConversationWeightedCards(
  root: ConversationA2UINode,
  answer: string,
): ArchivedConversationWeightedCardsLayout | undefined {
  const slots = cardSlots(root);
  if (!slots?.length) return;
  const weights = slots.flatMap((node, index) => {
    const weight = conversationA2UICardWeight(node);
    return weight === undefined ? [] : [[index, weight] as const];
  });
  if (!weights.length) return;
  const base = storeConversationA2UILayout(root, answer);
  if (base) return { version: 10, base, weights };
}

export function restoreArchivedConversationWeightedCards(
  value: unknown,
  answer: string,
) {
  if (
    !record(value) ||
    !keys(value, ['version', 'base', 'weights']) ||
    value.version !== 10 ||
    !Array.isArray(value.weights) ||
    value.weights.length === 0 ||
    value.weights.length > 64
  )
    return;
  const root = restoreConversationA2UILayout(value.base, answer);
  const slots = root && cardSlots(root);
  if (!root || !slots || value.weights.length > slots.length) return;
  let last = -1;
  const marks: [ConversationA2UINode, number][] = [];
  for (const tuple of value.weights as unknown[]) {
    if (!Array.isArray(tuple) || tuple.length !== 2) return;
    const [index, weight] = tuple;
    if (
      typeof index !== 'number' ||
      !Number.isInteger(index) ||
      index <= last ||
      index >= slots.length ||
      !isConversationA2UIRowWeight(weight)
    )
      return;
    marks.push([slots[index], weight]);
    last = index;
  }
  for (const [node, weight] of marks)
    markConversationA2UICardWeight(node, weight);
  restored.add(root);
  return root;
}
