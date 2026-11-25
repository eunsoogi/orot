import {
  conversationA2UICatalog,
  conversationA2UIFrameLimit,
} from './conversationA2UI';
import {
  conversationA2UIProse,
  draftA2UISurfaceId,
} from './conversationA2UIPresentation';
import {
  displayText,
  fail,
  id,
  keys,
  object,
} from './conversationA2UIWireValues';

const itemsPath = '/items';
const maxItems = 12;
const maxTemplateNodes = 8;
const maxTemplateDepth = 4;
const maxGraphNodes = 64;
const relativeKey = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/u;
type Node = Record<string, unknown> & { id: string };

function envelope(
  raw: unknown,
  operation: 'createSurface' | 'updateDataModel',
) {
  if (typeof raw !== 'string' || raw.length > conversationA2UIFrameLimit)
    fail();
  const message = object(JSON.parse(raw) as unknown);
  keys(message, ['version', operation]);
  const body = object(message[operation]);
  if (message.version !== '1.0' || body.surfaceId !== draftA2UISurfaceId)
    fail();
  return body;
}

/** Templates are closed, shallow owned trees. No nested repetition,
 * cross-tree refs, shared children, absolute bindings or callable functions. */
function collectTemplate(nodes: ReadonlyMap<string, Node>, root: string) {
  const template = new Map<string, Node>();
  const fields = new Set<string>();
  function visit(nodeId: string, depth: number) {
    const node = nodes.get(nodeId);
    if (
      !node ||
      nodeId === 'root' ||
      depth > maxTemplateDepth ||
      template.has(nodeId) ||
      template.size >= maxTemplateNodes
    )
      fail();
    template.set(nodeId, node);
    if (node.component === 'Text') {
      keys(node, ['id', 'component', 'variant', 'text']);
      if (node.variant !== undefined && node.variant !== 'body') fail();
      const text = object(node.text);
      keys(text, ['@path']);
      const field = text['@path'];
      if (typeof field !== 'string' || !relativeKey.test(field)) fail();
      fields.add(id(field));
      return;
    }
    if (node.component === 'Card') {
      keys(node, ['id', 'component', 'child']);
      visit(id(node.child), depth + 1);
      return;
    }
    if (node.component !== 'Row' && node.component !== 'Column') fail();
    keys(node, ['id', 'component', 'children']);
    if (
      !Array.isArray(node.children) ||
      !node.children.length ||
      node.children.length > 4
    )
      fail();
    for (const child of node.children as unknown[]) visit(id(child), depth + 1);
  }
  visit(root, 1);
  return { template, fields };
}

function readRows(raw: unknown, fields: ReadonlySet<string>) {
  if (!Array.isArray(raw) || !raw.length || raw.length > maxItems) fail();
  return (raw as unknown[]).map(value => {
    const row = object(value);
    if (Object.keys(row).length !== fields.size) fail();
    const accepted = new Map<string, string>();
    for (const field of fields) {
      if (!Object.hasOwn(row, field)) fail();
      const text = displayText(row[field]);
      // One field stands for one accepted paragraph. The exact final answer
      // is still checked against the fully materialized graph downstream.
      if (conversationA2UIProse(text)?.length !== 1) fail();
      accepted.set(field, text);
    }
    return accepted;
  });
}

function materialize(
  template: ReadonlyMap<string, Node>,
  rows: readonly ReadonlyMap<string, string>[],
  declared: ReadonlyMap<string, Node>,
) {
  return rows.flatMap((row, index) =>
    [...template.values()].map(node => {
      const scoped = (name: unknown) => {
        const clone = id(`repeat-${index}-${id(name)}`);
        if (declared.has(clone)) fail();
        return clone;
      };
      const newId = scoped(node.id);
      if (node.component === 'Text') {
        const field = id(object(node.text)['@path']);
        return { ...node, id: newId, text: row.get(field) };
      }
      if (node.component === 'Card')
        return { ...node, id: newId, child: scoped(node.child) };
      return {
        ...node,
        id: newId,
        children: (node.children as unknown[]).map(scoped),
      };
    }),
  );
}

function referencesTemplate(node: Node, ownedIds: ReadonlySet<string>) {
  const isOwned = (value: unknown) =>
    typeof value === 'string' && ownedIds.has(value);
  // The wire cannot guess a derived ID or point into a removed template.
  return (
    isOwned(node.child) ||
    isOwned(node.trigger) ||
    isOwned(node.content) ||
    (Array.isArray(node.children) && node.children.some(isOwned)) ||
    (Array.isArray(node.tabs) &&
      node.tabs.some((tab: unknown) => isOwned(object(tab).child)))
  );
}

/** Produce a scratch static graph. Only final accepted-answer admission can
 * publish text; provisional callers must discard everything except geometry. */
export function lowerConversationRepeatedChildren(
  raw: unknown,
): readonly string[] | undefined {
  if (!Array.isArray(raw) || !raw.length || raw.length > 2) return;
  try {
    const create = envelope(raw[0], 'createSurface');
    keys(create, [
      'surfaceId',
      'catalogId',
      'sendDataModel',
      'components',
      'dataModel',
    ]);
    if (
      create.catalogId !== conversationA2UICatalog ||
      (create.sendDataModel !== undefined && create.sendDataModel !== false) ||
      !Array.isArray(create.components) ||
      !create.components.length ||
      create.components.length > maxGraphNodes
    )
      return;
    const nodes = new Map<string, Node>();
    let repeated: Node | undefined;
    let templateRoot: string | undefined;
    for (const item of create.components as unknown[]) {
      const node = object(item);
      const nodeId = id(node.id);
      if (nodes.has(nodeId)) fail();
      const validated = { ...node, id: nodeId };
      nodes.set(nodeId, validated);
      if (
        (node.component === 'List' ||
          node.component === 'Row' ||
          node.component === 'Column') &&
        typeof node.children === 'object' &&
        !Array.isArray(node.children)
      ) {
        if (repeated) fail();
        const binding = object(node.children);
        keys(binding, ['path', 'componentId']);
        if (binding.path !== itemsPath) fail();
        templateRoot = id(binding.componentId);
        repeated = validated;
      }
    }
    if (!repeated || !templateRoot) return;
    const { template, fields } = collectTemplate(nodes, templateRoot);
    const data = object(create.dataModel);
    keys(data, ['items']);
    let rows = readRows(data.items, fields);
    if (raw.length === 2) {
      const update = envelope(raw[1], 'updateDataModel');
      keys(update, ['surfaceId', 'path', 'value']);
      if (update.path !== itemsPath) fail();
      rows = readRows(update.value, fields);
    }
    if (
      nodes.size - template.size + rows.length * template.size >
      maxGraphNodes
    )
      fail();
    const children = rows.map((_, index) => `repeat-${index}-${templateRoot}`);
    const clones = materialize(template, rows, nodes);
    const isolated = new Set<string>([
      ...template.keys(),
      ...clones.map(node => node.id),
    ]);
    const ordinary = [...nodes.values()].filter(node => !template.has(node.id));
    if (ordinary.some(node => referencesTemplate(node, isolated))) fail();
    return [
      JSON.stringify({
        version: '1.0',
        createSurface: {
          surfaceId: create.surfaceId,
          catalogId: create.catalogId,
          sendDataModel: create.sendDataModel,
          components: [
            ...ordinary.map(node =>
              node === repeated ? { ...node, children } : node,
            ),
            ...clones,
          ],
        },
      }),
    ];
  } catch {
    return undefined;
  }
}
