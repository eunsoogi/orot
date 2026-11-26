import { hasConversationA2UIComposedControls } from './conversationA2UIComposedControlState';
import type { ConversationA2UINode } from './conversationA2UI';
import { isConversationA2UIRowWeight } from './conversationA2UIRowWeight';
import {
  archiveVersion,
  container,
  isAxis,
  isIcon,
  keys,
  readArchivedA2UIAlignment,
  readAlignedA2UIArchiveShape,
  record,
  type ArchivedA2UILayout,
  type Shape,
} from './conversationA2UIArchiveShape';
import {
  conversationA2UIFrameProse,
  conversationA2UIProse,
} from './conversationA2UIPresentation';
export type { ArchivedA2UILayout } from './conversationA2UIArchiveShape';

/** Serialize only an admitted native tree reproducing the existing accepted answer. */
export function storeConversationA2UILayout(
  root: ConversationA2UINode,
  answer: string,
): ArchivedA2UILayout | undefined {
  if (answer.length > 8_192 || hasConversationA2UIComposedControls(root))
    return undefined;
  const legacy = conversationA2UIProse(answer);
  const paragraphs = legacy ?? conversationA2UIFrameProse(answer);
  if (!paragraphs) return undefined;
  let visited = 0;
  let position = 0;
  let version: ArchivedA2UILayout['version'] = legacy ? 1 : 2;
  const raise = (v: ArchivedA2UILayout['version']) => {
    if (v > version) version = v;
  };
  function visit(
    value: unknown,
    depth: number,
    insideRow = false,
  ): Shape | undefined {
    if (++visited > 64 || depth > 10 || !record(value)) return undefined;
    if (value.component === 'Text') {
      const weight = value.weight;
      const fields = ['id', 'component', 'variant', 'text'];
      if (Object.hasOwn(value, 'weight')) {
        if (!insideRow || !isConversationA2UIRowWeight(weight)) return;
        fields.push('weight');
      }
      if (
        !keys(value, fields) ||
        value.variant !== 'body' ||
        typeof value.text !== 'string' ||
        value.text !== paragraphs![position++]
      )
        return;
      if (!isConversationA2UIRowWeight(weight)) return 0;
      raise(5);
      return ['WeightedText', weight];
    }
    if (value.component === 'Divider') {
      if (!keys(value, ['id', 'component', 'axis']) || !isAxis(value.axis))
        return;
      raise(3);
      return ['Divider', value.axis];
    }
    if (value.component === 'Icon') {
      if (!keys(value, ['id', 'component', 'name']) || !isIcon(value.name))
        return;
      raise(3);
      return ['Icon', value.name];
    }
    if (value.component === 'Tabs') {
      if (
        !keys(value, ['id', 'component', 'tabs']) ||
        !Array.isArray(value.tabs) ||
        value.tabs.length === 0 ||
        value.tabs.length > 8
      )
        return;
      raise(3);
      const panels: Shape[] = [];
      for (const tab of value.tabs as unknown[]) {
        if (
          !record(tab) ||
          !keys(tab, ['title', 'child']) ||
          typeof tab.title !== 'string' ||
          !tab.title.trim() ||
          tab.title !== paragraphs![position++]
        )
          return;
        const child = visit(tab.child, depth + 1);
        if (child === undefined) return;
        panels.push(child);
      }
      return ['Tabs', ...panels];
    }
    const hasAlignment = Object.hasOwn(value, 'alignment');
    const horizontal =
      value.component === 'List' && value.direction === 'horizontal';
    if (
      !container(value.component) ||
      !keys(value, [
        'id',
        'component',
        'children',
        ...(hasAlignment ? ['alignment'] : []),
        ...(horizontal ? ['direction'] : []),
      ]) ||
      !Array.isArray(value.children) ||
      !value.children.length ||
      value.children.length > (value.component === 'Card' ? 1 : 16)
    )
      return undefined;
    const children = value.children.map(child =>
      visit(child, depth + 1, value.component === 'Row'),
    );
    if (!children.every((child): child is Shape => child !== undefined)) return;
    if (hasAlignment) {
      const kind = value.component;
      if (kind === 'Card' || horizontal) return;
      const list = kind === 'List';
      const layout = readArchivedA2UIAlignment(value.alignment, list);
      if (!layout) return;
      raise(list ? 7 : 4);
      return [
        'Aligned',
        kind,
        layout.align ?? null,
        layout.justify ?? null,
        ...children,
      ];
    }
    if (horizontal) raise(6);
    return [horizontal ? 'HorizontalList' : value.component, ...children];
  }
  const tree = visit(root, 1);
  return tree !== undefined && position === paragraphs.length
    ? { version, tree }
    : undefined;
}
/** Read the local skeleton only; unrecognized or corrupt shapes fall back to stored prose. */
export function restoreConversationA2UILayout(
  value: unknown,
  answer: string,
): ConversationA2UINode | undefined {
  if (
    answer.length > 8_192 ||
    !record(value) ||
    !keys(value, ['version', 'tree']) ||
    !archiveVersion(value.version)
  )
    return undefined;
  const version = value.version;
  const paragraphs =
    version === 1
      ? conversationA2UIProse(answer)
      : conversationA2UIFrameProse(answer);
  if (!paragraphs) return undefined;
  let visited = 0;
  let position = 0;
  function readChildren(parts: unknown[], depth: number, row: boolean) {
    const children = parts.map(child => visit(child, depth + 1, row));
    return children.every(child => child !== undefined) ? children : undefined;
  }
  function visit(
    shape: unknown,
    depth: number,
    insideRow = false,
  ): ConversationA2UINode | undefined {
    if (++visited > 64 || depth > 10) return undefined;
    const id = `archive-${visited}`;
    if (shape === 0) {
      const text = paragraphs![position++];
      return text === undefined
        ? undefined
        : { id, component: 'Text', variant: 'body', text };
    }
    if (!Array.isArray(shape)) return undefined;
    if (version >= 5 && shape[0] === 'WeightedText') {
      const text = paragraphs![position++];
      return insideRow &&
        shape.length === 2 &&
        text !== undefined &&
        isConversationA2UIRowWeight(shape[1])
        ? { id, component: 'Text', variant: 'body', text, weight: shape[1] }
        : undefined;
    }
    if (version >= 4 && shape[0] === 'Aligned') {
      const named = readAlignedA2UIArchiveShape(shape, version);
      if (!named) return;
      const children = readChildren(
        shape.slice(4),
        depth,
        named.kind === 'Row',
      );
      return children
        ? { id, component: named.kind, children, alignment: named.alignment }
        : undefined;
    }
    if (version >= 3) {
      if (shape[0] === 'Divider')
        return shape.length === 2 && isAxis(shape[1])
          ? { id, component: 'Divider', axis: shape[1] }
          : undefined;
      if (shape[0] === 'Icon')
        return shape.length === 2 && isIcon(shape[1])
          ? { id, component: 'Icon', name: shape[1] }
          : undefined;
      if (shape[0] === 'Tabs') {
        if (shape.length < 2 || shape.length > 9) return;
        const tabs = [];
        for (const panel of shape.slice(1)) {
          const title = paragraphs![position++];
          if (!title) return;
          const child = visit(panel, depth + 1);
          if (!child) return;
          tabs.push({ title, child });
        }
        return { id, component: 'Tabs', tabs };
      }
    }
    const horizontal = version >= 6 && shape[0] === 'HorizontalList';
    const component = horizontal ? 'List' : shape[0];
    if (
      !container(component) ||
      shape.length < 2 ||
      shape.length > (component === 'Card' ? 2 : 17)
    )
      return undefined;
    const children = readChildren(shape.slice(1), depth, component === 'Row');
    return children
      ? {
          id,
          component,
          children,
          ...(horizontal ? { direction: 'horizontal' as const } : {}),
        }
      : undefined;
  }
  const root = visit(value.tree, 1);
  return position === paragraphs.length ? root : undefined;
}
