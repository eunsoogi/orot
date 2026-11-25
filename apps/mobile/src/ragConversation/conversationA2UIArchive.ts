import type { ConversationA2UINode } from './conversationA2UI';
import {
  conversationA2UIFrameProse,
  conversationA2UIProse,
} from './conversationA2UIPresentation';

type Container = Exclude<
  ConversationA2UINode,
  { component: 'Text' }
>['component'];
type Shape = 0 | readonly [Container, ...Shape[]];

/** Contains only app-approved arrangement, not wire frames, IDs or independent prose. */
export type ArchivedA2UILayout = Readonly<{ version: 1 | 2; tree: Shape }>;

const containers = new Set<Container>(['Card', 'Column', 'List', 'Row']);
const container = (value: unknown): value is Container =>
  typeof value === 'string' && containers.has(value as Container);
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(value).length === allowed.length &&
  allowed.every(key => Object.hasOwn(value, key));

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
  function visit(value: unknown, depth: number): Shape | undefined {
    if (++visited > 64 || depth > 10 || !record(value)) return undefined;
    if (value.component === 'Text')
      return keys(value, ['id', 'component', 'variant', 'text']) &&
        value.variant === 'body' &&
        typeof value.text === 'string' &&
        value.text === paragraphs![position++]
        ? 0
        : undefined;
    if (
      !container(value.component) ||
      !keys(value, ['id', 'component', 'children']) ||
      !Array.isArray(value.children) ||
      !value.children.length ||
      value.children.length > (value.component === 'Card' ? 1 : 16)
    )
      return undefined;
    const children = value.children.map(child => visit(child, depth + 1));
    return children.every((child): child is Shape => child !== undefined)
      ? [value.component, ...children]
      : undefined;
  }
  const tree = visit(root, 1);
  return tree !== undefined && position === paragraphs.length
    ? { version: legacy ? 1 : 2, tree }
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
    (value.version !== 1 && value.version !== 2)
  )
    return undefined;
  const paragraphs =
    value.version === 1
      ? conversationA2UIProse(answer)
      : conversationA2UIFrameProse(answer);
  if (!paragraphs) return undefined;
  let visited = 0;
  let position = 0;
  function visit(
    shape: unknown,
    depth: number,
  ): ConversationA2UINode | undefined {
    if (++visited > 64 || depth > 10) return undefined;
    const id = `archive-${visited}`;
    if (shape === 0) {
      const text = paragraphs![position++];
      return text === undefined
        ? undefined
        : { id, component: 'Text', variant: 'body', text };
    }
    if (
      !Array.isArray(shape) ||
      !container(shape[0]) ||
      shape.length < 2 ||
      shape.length > (shape[0] === 'Card' ? 2 : 17)
    )
      return undefined;
    const children = shape.slice(1).map(child => visit(child, depth + 1));
    return children.every(
      (child): child is ConversationA2UINode => child !== undefined,
    )
      ? { id, component: shape[0], children }
      : undefined;
  }
  const root = visit(value.tree, 1);
  return position === paragraphs.length ? root : undefined;
}
