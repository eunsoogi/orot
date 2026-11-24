/**
 * Orot's read-only subset of A2UI 1.0 (agent_to_renderer + bundled Basic).
 * https://a2ui.org/specification/v1.0/schemas/
 * Catalog ID is a protocol constant, never fetched. Text is plain native text.
 */
export const conversationA2UICatalog =
  'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json';
export const conversationA2UIFrameLimit = 16_384;
export const maxNodes = 64;
const maxText = 2_048;
const maxDataKeys = 128;
const invalidKeyCharacter = /[^a-zA-Z0-9_-]/;

export type RowKind = 'Column' | 'Row' | 'List';
export type TextVariant = 'body' | 'caption';
export type WireNode =
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

export function fail(): never {
  throw new Error('Invalid or unsupported A2UI surface');
}

// Only called on values obtained from JSON.parse or on records built in this module.
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}

function keys(record: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(record).some(key => !allowed.includes(key))) fail();
}

function id(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > 64 ||
    invalidKeyCharacter.test(value) ||
    value === '__proto__' ||
    value === 'constructor' ||
    value === 'prototype'
  )
    fail();
  return value;
}

function binding(value: unknown): readonly string[] {
  if (typeof value !== 'string' || value.length > 320 || !value.startsWith('/'))
    fail();
  const parts = value.slice(1).split('/');
  if (parts.length > 6) fail();
  return parts.map(id);
}

function displayText(value: unknown): string {
  if (typeof value !== 'string' || value.length > maxText) fail();
  return value;
}

function components(value: unknown): WireNode[] {
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
      if (typeof node.text === 'string')
        return { id: nodeId, component, variant, text: displayText(node.text) };
      const ref = object(node.text);
      keys(ref, ['@path']);
      return { id: nodeId, component, variant, text: binding(ref['@path']) };
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
            body.components === undefined ? [] : components(body.components),
          data:
            body.dataModel === undefined
              ? Object.create(null)
              : recordData(body.dataModel),
        };
      case 'updateComponents':
        keys(body, ['surfaceId', 'components']);
        return { kind: 'components', components: components(body.components) };
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
