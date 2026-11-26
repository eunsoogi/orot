import { conversationA2UICatalog } from './conversationA2UI';
import {
  materializeRepeatedText,
  readRepeatedText,
} from './conversationA2UIRepeatedText';
import { envelope, readReplacements } from './conversationA2UIRepeatedWire';
import { conversationA2UIProse } from './conversationA2UIPresentation';
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
type Node = Record<string, unknown> & { id: string };

/** Templates are closed, shallow owned trees. No nested repetition,
 * cross-tree refs, shared children or absolute bindings. */
function collectTemplate(
  nodes: ReadonlyMap<string, Node>,
  root: string,
  formatted: boolean,
) {
  const template = new Map<string, Node>();
  const fields = new Set<string>();
  const bindings = new Map<string, ReturnType<typeof readRepeatedText>>();
  let usesFormat = false;
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
      bindings.set(nodeId, readRepeatedText(node.text, formatted, fields));
      usesFormat ||= Object.hasOwn(object(node.text), '@call');
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
  return { template, fields, bindings, usesFormat };
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
  bindings: ReadonlyMap<string, ReturnType<typeof readRepeatedText>>,
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
        const binding = bindings.get(node.id) ?? fail();
        return {
          ...node,
          id: newId,
          text: materializeRepeatedText(binding, row),
        };
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
  composed = false,
  formatted = false,
): readonly string[] | undefined {
  if (!Array.isArray(raw) || !raw.length || raw.length > (composed ? 3 : 2))
    return;
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
    const sections = new Map<string, { node: Node; root: string }>();
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
        const binding = object(node.children);
        keys(binding, ['path', 'componentId']);
        const path = binding.path;
        if (path !== itemsPath && !(composed && path === '/secondaryItems'))
          fail();
        if (sections.has(path)) fail();
        sections.set(path, { node: validated, root: id(binding.componentId) });
      }
    }
    if (!sections.has(itemsPath) || (composed && sections.size !== 2)) return;
    const data = object(create.dataModel);
    keys(
      data,
      [...sections.keys()].map(path => path.slice(1)),
    );
    const updates = readReplacements(raw.slice(1), sections);
    const originals = new Set<string>();
    const derived = new Map<string, Node>();
    const childLists = new Map<string, string[]>();
    let usesFormat = false;
    // Isolate both trees against all declarations and one another before
    // emitting anything that can reach the accepted prose validator.
    for (const [path, { node, root }] of sections) {
      const selection = collectTemplate(nodes, root, formatted);
      const { template, fields, bindings } = selection;
      usesFormat ||= selection.usesFormat;
      for (const name of template.keys()) {
        if (originals.has(name)) fail();
        originals.add(name);
      }
      let rows = readRows(data[path.slice(1)], fields);
      if (updates.has(path)) rows = readRows(updates.get(path), fields);
      childLists.set(
        node.id,
        rows.map((_, index) => `repeat-${index}-${root}`),
      );
      for (const clone of materialize(template, rows, nodes, bindings)) {
        if (derived.has(clone.id) || derived.size >= maxGraphNodes) fail();
        derived.set(clone.id, clone);
      }
    }
    if (
      (formatted && !usesFormat) ||
      nodes.size - originals.size + derived.size > maxGraphNodes
    )
      fail();
    const isolated = new Set([...originals, ...derived.keys()]);
    const ordinary = [...nodes.values()].filter(
      node => !originals.has(node.id),
    );
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
              childLists.has(node.id)
                ? { ...node, children: childLists.get(node.id) }
                : node,
            ),
            ...derived.values(),
          ],
        },
      }),
    ];
  } catch {
    return undefined;
  }
}
