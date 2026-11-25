import type { ConversationA2UINode } from './conversationA2UI';
import { isConversationA2UIRowWeight } from './conversationA2UIRowWeight';
import {
  container,
  isAxis,
  isIcon,
  keys,
  readAlignment,
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
  if (answer.length > 8_192) return undefined;
  const legacy = conversationA2UIProse(answer);
  const paragraphs = legacy ?? conversationA2UIFrameProse(answer);
  if (!paragraphs) return undefined;
  let visited = 0;
  let position = 0;
  let extended = false;
  let aligned = false;
  let weighted = false;
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
      weighted = true;
      return ['WeightedText', weight];
    }
    if (value.component === 'Divider') {
      if (!keys(value, ['id', 'component', 'axis']) || !isAxis(value.axis))
        return;
      extended = true;
      return ['Divider', value.axis];
    }
    if (value.component === 'Icon') {
      if (!keys(value, ['id', 'component', 'name']) || !isIcon(value.name))
        return;
      extended = true;
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
      extended = true;
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
    if (
      !container(value.component) ||
      !keys(
        value,
        hasAlignment
          ? ['id', 'component', 'children', 'alignment']
          : ['id', 'component', 'children'],
      ) ||
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
      if (value.component !== 'Column' && value.component !== 'Row') return;
      const input = value.alignment;
      if (
        !record(input) ||
        Object.keys(input).some(key => key !== 'align' && key !== 'justify')
      )
        return;
      const layout = readAlignment(input.align, input.justify);
      if (!layout) return;
      aligned = true;
      return [
        'Aligned',
        value.component,
        layout.align ?? null,
        layout.justify ?? null,
        ...children,
      ];
    }
    return [value.component, ...children];
  }
  const tree = visit(root, 1);
  return tree !== undefined && position === paragraphs.length
    ? {
        version: weighted ? 5 : aligned ? 4 : extended ? 3 : legacy ? 1 : 2,
        tree,
      }
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
    (value.version !== 1 &&
      value.version !== 2 &&
      value.version !== 3 &&
      value.version !== 4 &&
      value.version !== 5)
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
    if (version === 5 && Array.isArray(shape) && shape[0] === 'WeightedText') {
      const text = paragraphs![position++];
      return insideRow &&
        shape.length === 2 &&
        text !== undefined &&
        isConversationA2UIRowWeight(shape[1])
        ? { id, component: 'Text', variant: 'body', text, weight: shape[1] }
        : undefined;
    }
    if (version >= 4 && Array.isArray(shape) && shape[0] === 'Aligned') {
      if (
        (shape[1] !== 'Row' && shape[1] !== 'Column') ||
        shape.length < 5 ||
        shape.length > 20
      )
        return;
      const alignment = readAlignment(
        shape[2] === null ? undefined : shape[2],
        shape[3] === null ? undefined : shape[3],
      );
      if (!alignment) return;
      const children = shape
        .slice(4)
        .map(child => visit(child, depth + 1, shape[1] === 'Row'));
      return children.every(
        (child): child is ConversationA2UINode => child !== undefined,
      )
        ? { id, component: shape[1], children, alignment }
        : undefined;
    }
    if (version >= 3 && Array.isArray(shape)) {
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
    if (
      !Array.isArray(shape) ||
      !container(shape[0]) ||
      shape.length < 2 ||
      shape.length > (shape[0] === 'Card' ? 2 : 17)
    )
      return undefined;
    const children = shape
      .slice(1)
      .map(child => visit(child, depth + 1, shape[0] === 'Row'));
    return children.every(
      (child): child is ConversationA2UINode => child !== undefined,
    )
      ? { id, component: shape[0], children }
      : undefined;
  }
  const root = visit(value.tree, 1);
  return position === paragraphs.length ? root : undefined;
}
