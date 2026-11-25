import {
  conversationA2UIIcons,
  type ConversationA2UIStaticLeaf,
} from './conversationA2UIStaticCatalog';
import {
  binding,
  dataString,
  displayText,
  fail,
  id,
  keys,
  object,
} from './conversationA2UIWireValues';

export { fail } from './conversationA2UIWireValues';

/**
 * Orot's read-only subset of A2UI 1.0 (agent_to_renderer + bundled Basic).
 * https://a2ui.org/specification/v1.0/schemas/
 * Catalog ID is a protocol constant, never fetched. Text is plain native text.
 */
export const conversationA2UICatalog =
  'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json';
export const conversationA2UIFrameLimit = 16_384;
export const maxNodes = 64;
const maxDataKeys = 128;

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
    }
  | {
      readonly id: string;
      readonly component: 'Card' | RowKind;
      readonly children: readonly string[];
    };
export type Data = { [key: string]: string | Data };
type Frame =
  | {
      readonly kind: 'create';
      readonly components: readonly WireNode[];
      readonly data: Data;
    }
  | { readonly kind: 'components'; readonly components: readonly WireNode[] }
  | {
      readonly kind: 'data';
      readonly path: readonly string[];
      readonly value: string | Data | null;
    }
  | { readonly kind: 'delete' };

function components(value: unknown, allowStaticCatalog: boolean): WireNode[] {
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
      keys(node, ['id', 'component', 'text', 'variant']);
      const variant = node.variant ?? 'body';
      if (
        (variant !== 'body' && variant !== 'caption') ||
        node.variant === null
      )
        fail();
      return { id: nodeId, component, variant, text: dataString(node.text) };
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
    keys(node, ['id', 'component', 'children']);
    if (
      !Array.isArray(node.children) ||
      node.children.length === 0 ||
      node.children.length > 16
    )
      fail();
    return { id: nodeId, component, children: node.children.map(id) };
  });
}

export function recordData(
  value: unknown,
  depth = 0,
  budget = { count: 0 },
): Data {
  if (depth >= 6) fail();
  const data: Data = Object.create(null);
  for (const [key, item] of Object.entries(object(value))) {
    if (++budget.count > maxDataKeys) fail();
    data[id(key)] =
      typeof item === 'string'
        ? displayText(item)
        : recordData(item, depth + 1, budget);
  }
  return data;
}

export function makeConversationA2UISurfaceId(
  conversationId: string,
  messageId: string,
): string {
  return `orot:${id(conversationId)}:${id(messageId)}`;
}

export function parseConversationA2UIFrame(
  raw: string,
  expectedSurfaceId: string,
  allowStaticCatalog = false,
): Frame | 'foreign' | 'invalid' {
  if (typeof raw !== 'string' || raw.length > conversationA2UIFrameLimit)
    return 'invalid';
  try {
    const envelope = object(JSON.parse(raw) as unknown);
    const operation = Object.keys(envelope).find(key => key !== 'version');
    if (!operation) fail();
    const body = object(envelope[operation]);
    if (typeof body.surfaceId !== 'string') fail();
    if (body.surfaceId !== expectedSurfaceId) return 'foreign';
    const [prefix, conversation, message, ...suffix] =
      expectedSurfaceId.split(':');
    if (
      prefix !== 'orot' ||
      suffix.length ||
      makeConversationA2UISurfaceId(conversation, message) !== expectedSurfaceId
    )
      fail();
    keys(envelope, ['version', operation]);
    if (envelope.version !== '1.0') fail();
    switch (operation) {
      case 'createSurface':
        keys(body, [
          'surfaceId',
          'catalogId',
          'sendDataModel',
          'components',
          'dataModel',
        ]);
        if (
          body.catalogId !== conversationA2UICatalog ||
          (body.sendDataModel !== undefined && body.sendDataModel !== false)
        )
          fail();
        return {
          kind: 'create',
          components:
            body.components === undefined
              ? []
              : components(body.components, allowStaticCatalog),
          data:
            body.dataModel === undefined
              ? Object.create(null)
              : recordData(body.dataModel),
        };
      case 'updateComponents':
        keys(body, ['surfaceId', 'components']);
        return {
          kind: 'components',
          components: components(body.components, allowStaticCatalog),
        };
      case 'updateDataModel': {
        keys(body, ['surfaceId', 'path', 'value']);
        const path =
          body.path === undefined || body.path === '/'
            ? []
            : binding(body.path);
        const value = body.value;
        if (value === null) return { kind: 'data', path, value };
        return {
          kind: 'data',
          path,
          value:
            path.length && typeof value === 'string'
              ? displayText(value)
              : recordData(value),
        };
      }
      case 'deleteSurface':
        keys(body, ['surfaceId']);
        return { kind: 'delete' };
      default:
        return 'invalid';
    }
  } catch {
    return 'invalid';
  }
}
