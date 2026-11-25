import type { ConversationA2UIAlignment } from './conversationA2UIAlignment';
import type { ConversationA2UIStaticLeaf } from './conversationA2UIStaticCatalog';
import {
  conversationA2UIFrameLimit,
  fail,
  maxNodes,
  parseConversationA2UIFrame,
  recordData,
  type Data,
  type RowKind,
  type TextVariant,
  type WireNode,
} from './conversationA2UIWire';

export {
  conversationA2UICatalog,
  conversationA2UIFrameLimit,
  makeConversationA2UISurfaceId,
} from './conversationA2UIWire';

const maxFrames = 48;
const maxDepth = 10;
const maxTextTotal = 8_192;

export type ConversationA2UINode =
  | ConversationA2UIStaticLeaf
  | {
      readonly id: string;
      readonly component: 'Tabs';
      readonly tabs: readonly Readonly<{
        title: string;
        child: ConversationA2UINode;
      }>[];
    }
  | {
      readonly id: string;
      readonly component: 'Text';
      readonly variant: TextVariant;
      readonly text: string;
    }
  | {
      readonly id: string;
      readonly component: 'Card' | RowKind;
      readonly children: readonly ConversationA2UINode[];
      readonly alignment?: ConversationA2UIAlignment;
    };

export type ConversationA2UIState =
  | {
      readonly status: 'invalid';
      readonly surfaceId: string;
      readonly root: null;
    }
  | {
      readonly status: 'deleted';
      readonly surfaceId: string;
      readonly root: null;
    }
  | {
      readonly status: 'pending' | 'ready';
      readonly surfaceId: string;
      readonly root: ConversationA2UINode | null;
      readonly components: ReadonlyMap<string, WireNode>;
      readonly data: Data;
      readonly frameCount: number;
      readonly frameUnits: number;
    };

function updateData(
  original: Data,
  path: readonly string[],
  value: string | Data | null,
): Data {
  if (!path.length) {
    if (typeof value === 'string') fail();
    return value ?? Object.create(null);
  }
  const data: Data = Object.assign(Object.create(null), original);
  const [segment, ...rest] = path;
  const previous = data[segment];
  if (rest.length) {
    if (typeof previous === 'string') fail();
    data[segment] = updateData(previous ?? Object.create(null), rest, value);
  } else if (value === null) {
    delete data[segment];
  } else {
    data[segment] = value;
  }
  return data;
}

function resolve(data: Data, path: readonly string[]): string | undefined {
  let current: Data | string | undefined = data;
  for (const segment of path) {
    if (typeof current === 'string') fail();
    current = current?.[segment];
  }
  if (current !== undefined && typeof current !== 'string') fail();
  return current;
}

/** Every reference, including hidden tab panels, participates in one graph. */
function childIds(component: WireNode): readonly string[] {
  if (component.component === 'Tabs')
    return component.tabs.map(tab => tab.child);
  return 'children' in component ? component.children : [];
}

function buildTree(
  componentsById: ReadonlyMap<string, WireNode>,
  data: Data,
): ConversationA2UINode | null {
  // Validate structural integrity across *all* components, even unrendered ones.
  const parents = new Set<string>();
  for (const component of componentsById.values()) {
    for (const child of childIds(component)) {
      if (child === 'root' || parents.has(child)) fail();
      parents.add(child);
    }
  }
  const active = new Set<string>();
  const subtreeDepths = new Map<string, number>();
  function check(id: string): number {
    if (active.has(id)) fail();
    const component = componentsById.get(id);
    if (!component) return 0;
    if (active.size >= maxDepth) fail();
    const previousDepth = subtreeDepths.get(id);
    if (previousDepth !== undefined) return previousDepth;
    active.add(id);
    let depth = 1;
    for (const child of childIds(component))
      depth = Math.max(depth, 1 + check(child));
    if (depth > maxDepth) fail();
    active.delete(id);
    subtreeDepths.set(id, depth);
    return depth;
  }
  for (const component of componentsById.keys()) check(component);

  let complete = true;
  let textTotal = 0;
  const visited = new Set<string>();
  function boundedText(value: string | readonly string[]) {
    const text = typeof value === 'string' ? value : resolve(data, value);
    if (text !== undefined) textTotal += text.length;
    if (textTotal > maxTextTotal) fail();
    return text;
  }
  function build(id: string): ConversationA2UINode | null {
    const component = componentsById.get(id);
    if (!component) return null;
    visited.add(id);
    if (component.component === 'Text') {
      const text = boundedText(component.text);
      if (text === undefined) return null;
      return { ...component, text };
    }
    if (component.component === 'Divider' || component.component === 'Icon')
      return component;
    if (component.component === 'Tabs') {
      const tabs = [];
      for (const tab of component.tabs) {
        const title = boundedText(tab.title);
        const child = build(tab.child);
        if (!title?.trim() || !child) return null;
        tabs.push({ title, child });
      }
      return { ...component, tabs };
    }
    const children: ConversationA2UINode[] = [];
    for (const child of component.children) {
      const resolved = build(child);
      if (!resolved) complete = false;
      else children.push(resolved);
    }
    return { ...component, children };
  }
  const tree = build('root');
  return complete && visited.size === componentsById.size ? tree : null;
}

/** Reducer is scoped by trusted caller to a single active assistant message. */
export function applyConversationA2UIFrame(
  previous: ConversationA2UIState | null,
  raw: string,
  expectedSurfaceId: string,
  allowStaticCatalog = false,
  allowAlignment = false,
): ConversationA2UIState | null {
  if (
    previous &&
    (previous.surfaceId !== expectedSurfaceId ||
      previous.status === 'invalid' ||
      previous.status === 'deleted')
  )
    return previous;
  const frame = parseConversationA2UIFrame(
    raw,
    expectedSurfaceId,
    allowStaticCatalog,
    allowAlignment,
  );
  if (frame === 'foreign') return previous;
  const invalid = {
    status: 'invalid',
    surfaceId: expectedSurfaceId,
    root: null,
  } as const;
  if (frame === 'invalid' || (previous === null) !== (frame.kind === 'create'))
    return invalid;
  if (frame.kind === 'delete')
    return { status: 'deleted', surfaceId: expectedSurfaceId, root: null };

  try {
    // In a live round, a rejected local frame invalidates the optional surface, not the text answer.
    const frameCount = (previous?.frameCount ?? 0) + 1;
    const frameUnits = (previous?.frameUnits ?? 0) + raw.length;
    if (frameCount > maxFrames || frameUnits > conversationA2UIFrameLimit * 2)
      fail();
    const nextComponents = new Map(previous?.components);
    if (frame.kind !== 'data')
      for (const node of frame.components) nextComponents.set(node.id, node);
    if (nextComponents.size > maxNodes) fail();
    const data =
      frame.kind === 'create'
        ? frame.data
        : frame.kind === 'data'
          ? updateData(
              previous?.data ?? Object.create(null),
              frame.path,
              frame.value,
            )
          : (previous?.data ?? Object.create(null));
    // Path increments cannot bypass the aggregate data/depth checks.
    const checkedData = recordData(data);
    const root = buildTree(nextComponents, checkedData);
    return {
      status: root ? 'ready' : 'pending',
      surfaceId: expectedSurfaceId,
      root,
      components: nextComponents,
      data: checkedData,
      frameCount,
      frameUnits,
    };
  } catch {
    return invalid;
  }
}
