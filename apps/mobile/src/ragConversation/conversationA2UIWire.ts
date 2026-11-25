import {
  parseComponents,
  type WireNode,
} from './conversationA2UIWireComponents';
export {
  maxNodes,
  type WireNode,
  type RowKind,
  type TextVariant,
} from './conversationA2UIWireComponents';
import {
  binding,
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
const maxDataKeys = 128;

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
  allowAlignment = false,
  allowRowWeight = false,
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
              : parseComponents(
                  body.components,
                  allowStaticCatalog,
                  allowAlignment,
                  allowRowWeight,
                ),
          data:
            body.dataModel === undefined
              ? Object.create(null)
              : recordData(body.dataModel),
        };
      case 'updateComponents':
        keys(body, ['surfaceId', 'components']);
        return {
          kind: 'components',
          components: parseComponents(
            body.components,
            allowStaticCatalog,
            allowAlignment,
            allowRowWeight,
          ),
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
