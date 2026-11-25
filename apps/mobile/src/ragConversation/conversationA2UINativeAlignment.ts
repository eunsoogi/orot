import type { ConversationA2UINode } from './conversationA2UI';
import type { ViewStyle } from 'react-native';
import type { ConversationA2UIAlignment } from './conversationA2UIAlignment';

const cross: Record<
  NonNullable<ConversationA2UIAlignment['align']>,
  ViewStyle['alignItems']
> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
};
const main: Record<
  NonNullable<ConversationA2UIAlignment['justify']>,
  ViewStyle['justifyContent']
> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  spaceBetween: 'space-between',
  spaceAround: 'space-around',
  spaceEvenly: 'space-evenly',
  stretch: 'flex-start',
};

/** Fixed native styles only. A stacked Row deliberately ignores horizontal-axis hints. */
export function a2uiNativeAlignment(
  alignment?: ConversationA2UIAlignment,
): ViewStyle | undefined {
  if (!alignment) return undefined;
  return {
    alignItems: alignment.align ? cross[alignment.align] : undefined,
    justifyContent: alignment.justify ? main[alignment.justify] : undefined,
  };
}

export function a2uiNaturalRowChildren(alignment?: ConversationA2UIAlignment) {
  return alignment?.justify !== undefined && alignment.justify !== 'stretch';
}

export const a2uiStretchedColumnChild: ViewStyle = {
  flexGrow: 1,
  minWidth: 0,
  maxWidth: '100%',
};

/** Preserve proportional width only where the lightest child can still wrap
 * in a comfortably readable column; otherwise retain original stacked order. */
export function a2uiWeightedRow(nodes: readonly ConversationA2UINode[]) {
  if (
    !nodes.some(node => node.component === 'Text' && node.weight !== undefined)
  )
    return;
  const weights = nodes
    .filter(node => node.component !== 'Divider')
    .map(a2uiChildRowWeight);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return (
    (120 * total) / Math.min(...weights) +
    (nodes.length - 1) * 12 +
    nodes.length -
    weights.length
  );
}

export function a2uiChildRowWeight(node: ConversationA2UINode): number {
  return node.component === 'Text' ? (node.weight ?? 1) : 1;
}
