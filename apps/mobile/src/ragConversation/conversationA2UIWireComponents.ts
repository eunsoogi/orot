import {
  conversationA2UIIcons,
  type ConversationA2UIStaticLeaf,
} from './conversationA2UIStaticCatalog';
import {
  conversationA2UIAlignment,
  type ConversationA2UIAlignment,
} from './conversationA2UIAlignment';
import { isConversationA2UIRowWeight } from './conversationA2UIRowWeight';
import {
  dataString,
  fail,
  id,
  keys,
  object,
} from './conversationA2UIWireValues';

export const maxNodes = 64;
export type RowKind = 'Column' | 'Row' | 'List';
export type TextVariant = 'body' | 'caption';
export type WireNode =
  | ConversationA2UIStaticLeaf
  | {
      readonly id: string;
      readonly component: 'Tabs';
      readonly tabs: readonly Readonly<{
        title: string | readonly string[];
        child: string;
      }>[];
    }
  | {
      readonly id: string;
      readonly component: 'Text';
      readonly variant: TextVariant;
      readonly text: string | readonly string[];
      readonly weight?: number;
    }
  | {
      readonly id: string;
      readonly component: 'Card' | RowKind;
      readonly children: readonly string[];
      readonly alignment?: ConversationA2UIAlignment;
      readonly direction?: 'horizontal';
    };

export function parseComponents(
  value: unknown,
  allowStaticCatalog: boolean,
  allowAlignment: boolean,
  allowRowWeight = false,
  allowListDirection = false,
): WireNode[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxNodes)
    fail();
  const seen = new Set<string>();
  return value.map((item: unknown): WireNode => {
    const node = object(item);
    const nodeId = id(node.id);
    if (seen.has(nodeId)) fail();
    seen.add(nodeId);
    const component = node.component;
    if (component === 'Text') {
      keys(node, [
        'id',
        'component',
        'text',
        'variant',
        ...(allowRowWeight ? ['weight'] : []),
      ]);
      const weight = node.weight;
      if (Object.hasOwn(node, 'weight') && !isConversationA2UIRowWeight(weight))
        fail();
      const variant = node.variant ?? 'body';
      if (
        (variant !== 'body' && variant !== 'caption') ||
        node.variant === null
      )
        fail();
      return {
        id: nodeId,
        component,
        variant,
        text: dataString(node.text),
        ...(isConversationA2UIRowWeight(weight) ? { weight } : {}),
      };
    }
    // Reject these even on provisional V21 frames: replacing an unsupported
    // widget before the final frame must not retroactively make V21 valid.
    if (
      !allowStaticCatalog &&
      (component === 'Divider' || component === 'Icon' || component === 'Tabs')
    )
      fail();
    if (component === 'Divider') {
      keys(node, ['id', 'component', 'axis']);
      const axis = node.axis === undefined ? 'horizontal' : node.axis;
      if (axis !== 'horizontal' && axis !== 'vertical') fail();
      return { id: nodeId, component, axis };
    }
    if (component === 'Icon') {
      keys(node, ['id', 'component', 'name']);
      const name = node.name;
      if (
        typeof name !== 'string' ||
        !Object.hasOwn(conversationA2UIIcons, name)
      )
        fail();
      return {
        id: nodeId,
        component,
        name: name as keyof typeof conversationA2UIIcons,
      };
    }
    if (component === 'Tabs') {
      keys(node, ['id', 'component', 'tabs']);
      if (
        !Array.isArray(node.tabs) ||
        node.tabs.length === 0 ||
        node.tabs.length > 8
      )
        fail();
      const tabs = node.tabs.map((entry: unknown) => {
        const tab = object(entry);
        keys(tab, ['title', 'child']);
        return { title: dataString(tab.title), child: id(tab.child) };
      });
      return { id: nodeId, component, tabs };
    }
    if (component === 'Card') {
      keys(node, ['id', 'component', 'child']);
      return { id: nodeId, component, children: [id(node.child)] };
    }
    if (component !== 'Column' && component !== 'Row' && component !== 'List')
      fail();
    const supportsAlignment = allowAlignment && component !== 'List';
    const supportsDirection = allowListDirection && component === 'List';
    keys(node, [
      'id',
      'component',
      'children',
      ...(supportsAlignment ? ['align', 'justify'] : []),
      ...(supportsDirection ? ['direction'] : []),
    ]);
    const direction = node.direction;
    if (
      direction !== undefined &&
      direction !== 'vertical' &&
      direction !== 'horizontal'
    )
      fail();
    const alignment = supportsAlignment
      ? conversationA2UIAlignment(node.align, node.justify)
      : undefined;
    if (
      !Array.isArray(node.children) ||
      node.children.length === 0 ||
      node.children.length > 16
    )
      fail();
    return {
      id: nodeId,
      component,
      children: node.children.map(id),
      ...(alignment ? { alignment } : {}),
      ...(direction === 'horizontal' ? { direction } : {}),
    };
  });
}
