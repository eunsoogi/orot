import { a2uiSurfaceStyles } from './conversationA2UISurfaceStyles';
import {
  conversationA2UICardWeight,
  conversationA2UIColumnWeight,
  conversationA2UILiveMixedRowWeight,
} from './conversationA2UICardWeightTask';
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
  if (!nodes.some(node => explicitRowWeight(node) !== undefined)) return;
  const content = nodes.filter(node => node.component !== 'Divider');
  const weights = content.map(a2uiChildRowWeight);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  // Keep the old Text-only weight threshold. When a live Card weight enables
  // this new layout, every Card must preserve the same interior text width.
  const width = content.some(
    node => node.component === 'Card' && explicitRowWeight(node) !== undefined,
  )
    ? Math.max(
        ...content.map((node, index) => {
          const insets =
            node.component === 'Card' ? 2 * a2uiSurfaceStyles.card.padding : 0;
          return ((120 + insets) * total) / weights[index];
        }),
      )
    : (120 * total) / Math.min(...weights);
  return width + (nodes.length - 1) * 12 + nodes.length - weights.length;
}

export function a2uiChildRowWeight(node: ConversationA2UINode): number {
  return explicitRowWeight(node) ?? 1;
}

function explicitRowWeight(node: ConversationA2UINode) {
  return node.component === 'Text'
    ? node.weight
    : (conversationA2UICardWeight(node) ??
        conversationA2UIColumnWeight(node) ??
        conversationA2UILiveMixedRowWeight(node));
}
